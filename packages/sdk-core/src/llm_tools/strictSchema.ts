/**
 * Strict structured-output schema for LLM submission.
 *
 * OpenAI's structured outputs run in strict mode (`strict: true`, which
 * @ai-sdk/openai sets by default). Strict mode requires every key in an
 * object's `properties` to also appear in its `required` array — "may be
 * omitted" is expressed as a required-but-nullable key, never by leaving the
 * key out of `required`.
 *
 * Zod's `.optional()` and `.default()` both drop the key from `required`, so a
 * single one anywhere in the submitted schema makes the whole request invalid.
 * The API rejects it before the model is consulted, which killed the AI
 * fallback for every action:
 *
 *   AI_APICallError: Invalid schema for response_format 'response':
 *   In context=('properties','action','anyOf','0','properties','click'),
 *   'required' is required to be supplied and to be an array including every
 *   key in properties. Missing 'timeout_ms'.
 *
 * ## Why the fix is not in the tool schemas
 *
 * Rewriting every tool schema's `.optional()` as `.nullable()` is wrong: the
 * same Zod objects validate arguments that do not come from a model.
 * `ToolRegistry.execute()` parses replayed `action_data.kwargs` and MCP `act`
 * payloads with them, and neither carries a `timeout_ms` key. `.nullable()`
 * alone makes the key mandatory, so that change trades a broken AI fallback for
 * a broken replay and MCP path.
 *
 * ## Why the transform is on JSON Schema, not on Zod
 *
 * The first version of this rebuilt the Zod tree — `.optional()` became
 * `.nullable().transform(...)`, objects were reconstructed node by node. That
 * approach has to know every Zod node type, and it fails quietly or loudly on
 * each one it does not: `.pipe()`, `z.set()` and `z.map()` passed through with
 * their optionals intact and re-broke the request; `z.lazy()` lost
 * zod-to-json-schema's recursion detection and threw `RangeError`; `z.any()`
 * and `z.unknown()` are optional to `zodToJsonSchema` but are neither
 * `ZodOptional` nor `ZodDefault`, so they stayed out of `required`; `.min()` on
 * an array was dropped by the rebuild; a `.default([])` factory was evaluated
 * once and shared across parses; and every `instanceof` check silently failed
 * for a caller whose schema came from a second copy of Zod — which
 * `Agent.registerAction` makes reachable, since `@shiplightai/sdk` depends on
 * `zod` as a normal dependency.
 *
 * Rewriting the emitted JSON Schema instead removes that whole class. Node
 * coverage stops mattering: whatever `zodToJsonSchema` produced gets its
 * `required` completed and its optional properties made nullable, no matter
 * which Zod construct produced it. Validation keeps using the ORIGINAL Zod
 * schema, so defaults, refinements, coercions and array bounds all behave
 * exactly as they did before.
 *
 * The one bookkeeping job is undoing the nullability we added: the model is now
 * forced to emit a key it would previously have omitted, and it emits `null`.
 * `strictify` records exactly which keys it promoted, and `stripPromotedNulls`
 * deletes those `null`s before the original schema parses — so a `.default()`
 * still fires and a `.optional()` still reads as `undefined`. Keys that were
 * already required-and-nullable in the source are not recorded, so a `null` the
 * model genuinely meant survives.
 *
 * ## Limits
 *
 * `z.record()` cannot be expressed under strict mode at all: it emits
 * `additionalProperties` as a schema, and strict mode requires `false`. This
 * transform recurses into the value schema but cannot make such a request
 * valid. `validateStrictMode` (../llm_tools/schema.ts) reports it, and the
 * tests use that as their oracle.
 */

import { jsonSchema, type Schema } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type JsonSchemaObject = Record<string, unknown>;

/**
 * Which keys this transform promoted from optional to required-nullable, shaped
 * to mirror the schema so a parsed value can be walked alongside it. `undefined`
 * anywhere means "nothing was promoted in this subtree" — the common case, and
 * a fast path out of the strip walk.
 */
interface PromotedNode {
	/** Keys of THIS object that were promoted. */
	keys?: string[];
	/**
	 * Every property this object declares, promoted or not. Recorded only for
	 * union branches, where deciding whether a key is safe to strip needs to know
	 * which branches declare it while leaving it un-promoted. Not a promotion in
	 * its own right — `hasNoPromotions` ignores it.
	 */
	declared?: string[];
	/** Per-property promotions, for nested objects. */
	properties?: Record<string, PromotedNode>;
	/** Promotions inside array items (or each position, for a tuple). */
	items?: PromotedNode | Array<PromotedNode | undefined>;
	/** Promotions inside each anyOf/oneOf/allOf branch. */
	branches?: Array<PromotedNode | undefined>;
	/** Promotions inside a record's value schema. */
	additional?: PromotedNode;
}

function isPlainObject(value: unknown): value is JsonSchemaObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNoPromotions(node: PromotedNode): boolean {
	return (
		!node.keys?.length &&
		!node.properties &&
		!node.items &&
		!node.branches &&
		!node.additional
	);
}

/** Keywords that constrain which instances a schema accepts. */
const CONSTRAINING_KEYWORDS = [
	'type',
	'enum',
	'const',
	'anyOf',
	'oneOf',
	'allOf',
	'not',
	'$ref',
] as const;

/** Does this schema already accept `null`? Then promoting it changes nothing. */
function allowsNull(schema: JsonSchemaObject): boolean {
	const type = schema.type;
	if (type === 'null') return true;
	if (Array.isArray(type) && type.includes('null')) return true;
	for (const key of ['anyOf', 'oneOf'] as const) {
		const branches = schema[key];
		if (Array.isArray(branches) && branches.some((b) => isPlainObject(b) && allowsNull(b))) {
			return true;
		}
	}
	// An unconstrained schema — `{}`, which is what zodToJsonSchema emits for
	// z.any() and z.unknown() — accepts every instance, `null` included. Missing
	// this made the transform strip a null those fields genuinely accept, and with
	// `.default()` attached it silently substituted the default for a deliberate null.
	return CONSTRAINING_KEYWORDS.every((keyword) => schema[keyword] === undefined);
}

/**
 * Widen a property schema to accept `null`, which is how strict mode spells
 * "this may be absent". Uses the `type: [t, 'null']` form where the schema has
 * a plain type, because that is what Zod's own `.nullable()` emits and what
 * @ai-sdk/google knows how to fold into Gemini's `nullable: true`. Falls back to
 * `anyOf` for enums, literals and composites, where a type array would not be
 * valid.
 */
function makeNullable(schema: JsonSchemaObject): JsonSchemaObject {
	if (allowsNull(schema)) return schema;

	// `enum` and `const` are assertions on the instance that a widened `type`
	// array does not relax: `{type: ['string','null'], const: 'a'}` still rejects
	// null, so the model would have no way to signal absence. Those go through
	// the anyOf form instead.
	if (typeof schema.type === 'string' && schema.enum === undefined && schema.const === undefined) {
		return { ...schema, type: [schema.type, 'null'] };
	}

	// Keep the description on the outer node so the model still sees the field's
	// guidance without having to look into a branch.
	const { description, ...rest } = schema;
	return {
		...(description !== undefined ? { description } : {}),
		anyOf: [rest, { type: 'null' }],
	};
}

/**
 * Rewrite a JSON Schema so every object lists all of its properties in
 * `required`, widening the newly-required ones to accept `null`, and returning
 * the record of what was promoted.
 */
function strictify(schema: unknown): { schema: unknown; promoted?: PromotedNode } {
	if (!isPlainObject(schema)) return { schema };

	const next: JsonSchemaObject = { ...schema };
	const promoted: PromotedNode = {};

	const properties = schema.properties;
	if (isPlainObject(properties)) {
		// Every property becomes required. This covers constructs Zod-level
		// dispatch missed entirely — z.any(), z.unknown(), a union containing
		// z.undefined() — because it reads the emitted schema rather than
		// reasoning about which Zod node produced it.
		const originalRequired = new Set(
			Array.isArray(schema.required) ? (schema.required as string[]) : [],
		);
		const keys = Object.keys(properties);
		const promotedKeys: string[] = [];
		const childPromotions: Record<string, PromotedNode> = {};
		const nextProperties: JsonSchemaObject = {};

		for (const key of keys) {
			const child = properties[key];
			const result = strictify(child);
			let childSchema = result.schema;

			// Drop `default` BEFORE widening — afterwards the original node may be
			// nested inside an `anyOf` branch, where this check would not see it.
			// `default` is not part of the strict-mode keyword set, and the value is
			// applied by the original Zod schema on parse anyway.
			if (isPlainObject(childSchema) && 'default' in childSchema) {
				const { default: _dropped, ...withoutDefault } = childSchema;
				childSchema = withoutDefault;
			}

			if (!originalRequired.has(key)) {
				// Record for stripping only when the source would REJECT null. If the
				// field is already nullable (`z.string().nullable().optional()`), a
				// null from the model is a value the source accepts, and deleting it
				// would turn a deliberate null into the default. Such a key still
				// becomes required — it just does not need widening or undoing.
				if (isPlainObject(childSchema) && !allowsNull(childSchema)) {
					promotedKeys.push(key);
					childSchema = makeNullable(childSchema);
				}
			}

			nextProperties[key] = childSchema;
			if (result.promoted) childPromotions[key] = result.promoted;
		}

		next.properties = nextProperties;
		next.required = keys;
		// Strict mode requires this on every object, and the zod-3 path in
		// @ai-sdk/provider-utils does not add it — a `.passthrough()` schema
		// reaches OpenAI as `additionalProperties: true` and is rejected.
		next.additionalProperties = false;

		if (promotedKeys.length > 0) promoted.keys = promotedKeys;
		if (Object.keys(childPromotions).length > 0) promoted.properties = childPromotions;
	}

	// A record: `additionalProperties` is a schema rather than a boolean. Recurse
	// into it, but leave it a schema — forcing `false` would silently forbid the
	// very keys the record exists to carry. Such a schema stays strict-invalid;
	// validateStrictMode reports it.
	if (isPlainObject(schema.additionalProperties)) {
		const result = strictify(schema.additionalProperties);
		next.additionalProperties = result.schema;
		if (result.promoted) promoted.additional = result.promoted;
	}

	if (Array.isArray(schema.items)) {
		// Tuple form: each position has its own schema.
		const results = (schema.items as unknown[]).map((item) => strictify(item));
		next.items = results.map((r) => r.schema);
		if (results.some((r) => r.promoted)) promoted.items = results.map((r) => r.promoted);
	} else if (schema.items !== undefined) {
		const result = strictify(schema.items);
		next.items = result.schema;
		if (result.promoted) promoted.items = result.promoted;
	}

	for (const combinator of ['anyOf', 'oneOf', 'allOf'] as const) {
		const branches = schema[combinator];
		if (!Array.isArray(branches)) continue;
		const results = branches.map((branch) => strictify(branch));
		next[combinator] = results.map((r) => r.schema);
		if (results.some((r) => r.promoted)) {
			// One `branches` record serves every combinator; a schema mixing two of
			// them on the same node is not something zodToJsonSchema emits.
			//
			// Each entry carries the branch's declared property names even when that
			// branch promoted nothing, because a branch that declares a key and
			// leaves it required-and-nullable is exactly the one whose null must not
			// be stripped.
			promoted.branches = results.map((result, index) => {
				const branch = branches[index];
				const branchProperties = isPlainObject(branch) ? branch.properties : undefined;
				const declared = isPlainObject(branchProperties)
					? Object.keys(branchProperties)
					: undefined;
				if (!result.promoted && !declared) return undefined;
				return { ...(result.promoted ?? {}), ...(declared ? { declared } : {}) };
			});
		}
	}

	return { schema: next, promoted: hasNoPromotions(promoted) ? undefined : promoted };
}

/**
 * The item promotions that apply to an array value: this node's own, plus any
 * carried by a union branch. A value is only ever an array under one of them,
 * so the first that exists wins.
 */
function collectItemPromotions(
	promoted: PromotedNode,
): PromotedNode | Array<PromotedNode | undefined> | undefined {
	if (promoted.items !== undefined) return promoted.items;
	for (const branch of promoted.branches ?? []) {
		const fromBranch = branch && collectItemPromotions(branch);
		if (fromBranch !== undefined) return fromBranch;
	}
	return undefined;
}

/**
 * Narrow each branch's promoted keys to those every branch mentioning the key
 * agrees are promoted. See the call site for why unanimity is required.
 */
function restrictBranchesToUnanimous(
	branches: Array<PromotedNode | undefined> | undefined,
): Array<PromotedNode | undefined> {
	if (!branches || branches.length === 0) return [];

	// A key is safe to strip only if every branch that DECLARES it also promotes
	// it. A branch that does not declare the key has no opinion; a branch that
	// declares it and left it required-and-nullable is dissenting, and its null
	// carries meaning.
	const dissenting = new Set<string>();
	for (const branch of branches) {
		if (!branch?.declared) continue;
		const branchPromoted = new Set(branch.keys ?? []);
		for (const key of branch.declared) {
			if (!branchPromoted.has(key)) dissenting.add(key);
		}
	}
	if (dissenting.size === 0) return branches;

	return branches.map((branch) => {
		if (!branch?.keys?.length) return branch;
		const unanimous = branch.keys.filter((key) => !dissenting.has(key));
		return unanimous.length === branch.keys.length ? branch : { ...branch, keys: unanimous };
	});
}

/**
 * Delete the `null`s that only exist because this transform made a key
 * required, so the original schema sees the value the model would have sent
 * before the change — an absent key, which its `.optional()` or `.default()`
 * then handles.
 *
 * Only keys recorded by `strictify` are touched, so a `null` that the source
 * schema genuinely accepts (a required `.nullable()` field) is preserved.
 */
function stripPromotedNulls(value: unknown, promoted: PromotedNode | undefined): unknown {
	if (promoted === undefined || value === null || typeof value !== 'object') return value;

	if (Array.isArray(value)) {
		// `items` may sit on this node OR inside a union branch, so the branches
		// have to be folded in rather than skipped. Returning early on a missing
		// `promoted.items` silently left the injected nulls in place for an array
		// under an anyOf, and the original schema then rejected the model's own
		// schema-conformant response.
		const itemPromotions = collectItemPromotions(promoted);
		if (itemPromotions === undefined) return value;
		return value.map((item, index) =>
			stripPromotedNulls(item, Array.isArray(itemPromotions) ? itemPromotions[index] : itemPromotions),
		);
	}

	let next = value as Record<string, unknown>;
	let copied = false;
	const ensureCopy = () => {
		if (!copied) {
			next = { ...next };
			copied = true;
		}
		return next;
	};

	for (const key of promoted.keys ?? []) {
		if (next[key] === null) delete ensureCopy()[key];
	}

	for (const [key, childPromoted] of Object.entries(promoted.properties ?? {})) {
		if (!(key in next)) continue;
		const stripped = stripPromotedNulls(next[key], childPromoted);
		if (stripped !== next[key]) ensureCopy()[key] = stripped;
	}

	if (promoted.additional) {
		for (const key of Object.keys(next)) {
			const stripped = stripPromotedNulls(next[key], promoted.additional);
			if (stripped !== next[key]) ensureCopy()[key] = stripped;
		}
	}

	// A union member matched, but which one is not knowable here — only the
	// original schema can decide that, and it runs after this. So apply a branch's
	// promotion for a key only when EVERY branch that mentions the key promotes
	// it. Applying them unconditionally deleted a null that a different branch
	// required as a real value (`z.union([{v: z.number().optional()}, {v:
	// z.number().nullable()}])` turned a legal `{v: null}` into a `v: Required`
	// error). Where branches disagree the null is left in place: that fails loudly
	// on the branch that wanted it absent, rather than silently destroying data on
	// the branch that wanted it null.
	for (const branch of restrictBranchesToUnanimous(promoted.branches)) {
		const stripped = stripPromotedNulls(next, branch);
		if (stripped !== next) {
			next = stripped as Record<string, unknown>;
			copied = true;
		}
	}

	return next;
}

/**
 * Build the strict-mode JSON Schema for `schema` without wiring up validation.
 * Exported for tests and diagnostics; callers submitting to a model want
 * `toStrictOutputSchema`.
 */
export function toStrictJsonSchema(schema: z.ZodTypeAny): unknown {
	// Mirrors what @ai-sdk/provider-utils' zod-3 path does, so the only
	// difference between this and an untransformed submission is strictify.
	return strictify(zodToJsonSchema(schema, { $refStrategy: 'none' })).schema;
}

/**
 * A submission-only view of `schema` that satisfies OpenAI strict structured
 * outputs and still parses to exactly what `schema` would have produced.
 *
 * Pass it straight to `Output.object({ schema })` / `generateObject`. Never use
 * it to validate input that did not come from a model — the source schema is
 * the one that stays tolerant of omitted keys for replay and MCP.
 */
export function toStrictOutputSchema<T extends z.ZodTypeAny>(schema: T): Schema<z.infer<T>> {
	const { schema: strict, promoted } = strictify(
		zodToJsonSchema(schema, { $refStrategy: 'none' }),
	);

	return jsonSchema<z.infer<T>>(strict as JsonSchemaObject, {
		validate: async (value: unknown) => {
			// The ORIGINAL schema validates, so defaults, refinements, coercions and
			// array bounds behave exactly as they did before this transform existed.
			const result = await schema.safeParseAsync(stripPromotedNulls(value, promoted));
			return result.success
				? { success: true as const, value: result.data as z.infer<T> }
				: { success: false as const, error: result.error };
		},
	});
}
