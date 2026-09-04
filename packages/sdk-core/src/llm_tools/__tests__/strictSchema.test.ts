/**
 * Every schema submitted to a model must be valid under OpenAI strict
 * structured outputs.
 *
 * The rule strict mode enforces: every key in `properties` must also appear in
 * `required`, and every object must carry `additionalProperties: false`.
 * Optionality is expressed as a nullable REQUIRED key, never by omission. A Zod
 * `.optional()` (or `.default()`) omits the key from `required`, so a single one
 * anywhere in the submitted schema makes the whole `response_format` request
 * invalid and the API rejects it before the model is consulted:
 *
 *   AI_APICallError: Invalid schema for response_format 'response':
 *   In context=('properties','action','anyOf','0','properties','click'),
 *   'required' is required to be supplied and to be an array including every
 *   key in properties. Missing 'timeout_ms'.
 *
 * That kills the AI fallback for EVERY action, in every consuming repo — and it
 * is invisible until some deterministic locator fails and the fallback is asked
 * to run, which is exactly when you least want a second failure.
 *
 * These tests assert the invariant on the transform's OUTPUT, not on the source
 * tool schemas. The source schemas keep `.optional()` on purpose: the same Zod
 * objects validate replayed `action_data.kwargs` and MCP `act` payloads, which
 * legitimately omit those keys. See the header of ../strictSchema.ts.
 *
 * The oracle is `validateStrictMode` from ../schema.ts, which also checks
 * `additionalProperties`, `$ref` and `$defs` — a narrower check would certify
 * schemas the API still rejects.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { validateStrictMode } from '../schema';
import { toStrictJsonSchema, toStrictOutputSchema } from '../strictSchema';

interface JsonSchemaNode {
	type?: unknown;
	description?: string;
	properties?: Record<string, JsonSchemaNode>;
	required?: string[];
	minItems?: number;
	maxItems?: number;
}

function jsonOf(schema: z.ZodTypeAny): JsonSchemaNode {
	return toStrictJsonSchema(schema) as JsonSchemaNode;
}

/** Strict-mode errors in the SUBMITTED schema. Empty means the API accepts it. */
function strictErrors(schema: z.ZodTypeAny): string[] {
	return validateStrictMode(toStrictJsonSchema(schema));
}

/** Run a value through the submitted schema's validator, as the AI SDK does. */
async function validate<T extends z.ZodTypeAny>(schema: T, value: unknown) {
	return toStrictOutputSchema(schema).validate!(value);
}

async function parsed<T extends z.ZodTypeAny>(schema: T, value: unknown): Promise<unknown> {
	const result = await validate(schema, value);
	assert.ok(result.success, `expected ${JSON.stringify(value)} to validate`);
	return result.value;
}

describe('toStrictOutputSchema produces a strict-valid JSON Schema', () => {
	it('lists an .optional() field in required, as a nullable type', () => {
		const schema = z.object({
			element_index: z.number().int(),
			timeout_ms: z.number().optional(),
		});

		const json = jsonOf(schema);
		assert.deepStrictEqual(json.required, ['element_index', 'timeout_ms']);
		assert.deepStrictEqual(json.properties?.timeout_ms.type, ['number', 'null']);
		assert.deepStrictEqual(strictErrors(schema), []);
	});

	it('lists a .default() field in required too', () => {
		assert.deepStrictEqual(strictErrors(z.object({ thought: z.string().optional().default('') })), []);
	});

	it('recurses through nested objects, arrays and unions', () => {
		const schema = z.object({
			action: z.union([
				z.object({ click: z.object({ index: z.number(), timeout_ms: z.number().optional() }) }),
				z.object({ scroll: z.object({ delta_y: z.number().optional() }) }),
			]),
			steps: z.array(z.object({ note: z.string().optional() })),
			meta: z.object({ nested: z.object({ deep: z.boolean().optional() }) }),
		});
		assert.deepStrictEqual(strictErrors(schema), []);
	});

	it('forces additionalProperties: false even on a .passthrough() object', () => {
		// The zod-3 path in @ai-sdk/provider-utils does not add this, so a
		// passthrough schema reached OpenAI as additionalProperties: true and was
		// rejected — the same class of failure as the original bug.
		const schema = z.object({ a: z.number().optional() }).passthrough();
		assert.deepStrictEqual(strictErrors(schema), []);
	});

	it('covers constructs that are optional without being ZodOptional', () => {
		// z.any()/z.unknown() are omitted from `required` by zodToJsonSchema, but
		// they are neither ZodOptional nor ZodDefault — Zod-level dispatch missed
		// them entirely and left the request invalid.
		assert.deepStrictEqual(strictErrors(z.object({ done: z.any() })), []);
		assert.deepStrictEqual(strictErrors(z.object({ meta: z.unknown(), a: z.string() })), []);
	});

	it('covers wrappers that hide an optional field', () => {
		// Each of these previously passed through untransformed, keeping its inner
		// .optional() out of `required`. Reachable from user code: Agent.registerAction
		// (sdk-public) puts a caller's schema straight into the same union.
		const cases: Array<[string, z.ZodTypeAny]> = [
			['refine', z.object({ a: z.string(), b: z.number().optional() }).refine((v) => v.a !== 'no', 'bad')],
			['transform', z.object({ a: z.string(), b: z.number().optional() }).transform((v) => v)],
			['preprocess', z.preprocess((v) => v, z.object({ a: z.string(), b: z.number().optional() }))],
			['pipe', z.object({ o: z.string().optional() }).pipe(z.object({ o: z.string().optional() }))],
			['set', z.object({ s: z.set(z.object({ o: z.string().optional() })) })],
			[
				'discriminatedUnion',
				z.discriminatedUnion('kind', [
					z.object({ kind: z.literal('a'), x: z.number().optional() }),
					z.object({ kind: z.literal('b'), y: z.string().optional() }),
				]),
			],
			['tuple', z.object({ t: z.tuple([z.object({ v: z.number().optional() })]) })],
			['intersection', z.intersection(z.object({ a: z.string() }), z.object({ b: z.number().optional() }))],
			['readonly', z.object({ a: z.number().optional() }).readonly()],
			['catch', z.object({ a: z.number().optional() }).catch({ a: 1 })],
			['lazy', z.object({ inner: z.lazy(() => z.object({ o: z.string().optional() })) })],
		];
		for (const [name, schema] of cases) {
			assert.deepStrictEqual(strictErrors(schema), [], `${name} is not strict-valid`);
		}
	});

	it('does not stack-overflow on a recursive schema', () => {
		// The Zod-level rebuild minted a fresh instance per expansion, defeating
		// zod-to-json-schema's recursion detection and throwing RangeError from
		// inside generateText — which is not a NoObjectGeneratedError, so it
		// aborted the whole agent run instead of just losing the fallback.
		type Node = { name: string; child?: Node };
		const node: z.ZodType<Node> = z.lazy(() => z.object({ name: z.string(), child: node.optional() }));
		assert.doesNotThrow(() => toStrictJsonSchema(z.object({ root: node })));
	});

	it('keeps constraints the model should be steered by', () => {
		// The Zod-level rebuild reconstructed z.array(inner) and dropped these, so
		// the model was free to return an empty array that the raw schema then
		// rejected in ToolRegistry.execute.
		const json = jsonOf(z.object({ items: z.array(z.string()).min(2).max(5) }));
		assert.strictEqual(json.properties?.items.minItems, 2);
		assert.strictEqual(json.properties?.items.maxItems, 5);
	});

	it('drops `default`, which strict mode does not accept', () => {
		const json = jsonOf(z.object({ thought: z.string().optional().default('') }));
		assert.ok(!('default' in (json.properties?.thought ?? {})));
	});
});

describe('toStrictOutputSchema parses back to the original values', () => {
	it('turns an injected null back into undefined for .optional()', async () => {
		const schema = z.object({ element_index: z.number(), timeout_ms: z.number().optional() });
		const value = (await parsed(schema, { element_index: 4, timeout_ms: null })) as {
			timeout_ms?: number;
		};
		assert.deepStrictEqual(value, { element_index: 4 });
		assert.strictEqual(value.timeout_ms ?? 5000, 5000);
	});

	it('turns an injected null back into the default for .default()', async () => {
		const schema = z.object({
			thought: z.string().optional().default(''),
			completes_instruction: z.boolean().optional().default(true),
		});
		assert.deepStrictEqual(await parsed(schema, { thought: null, completes_instruction: null }), {
			thought: '',
			completes_instruction: true,
		});
	});

	it('preserves a null the source schema genuinely accepts', async () => {
		// A key that is optional AND nullable is left un-promoted: the model's null
		// is a value the source accepts, so deleting it would silently substitute
		// the default for a deliberate null.
		assert.deepStrictEqual(await parsed(z.object({ mode: z.string().nullable().default('auto') }), { mode: null }), {
			mode: null,
		});
		assert.deepStrictEqual(await parsed(z.object({ mode: z.string().nullable().optional() }), { mode: null }), {
			mode: null,
		});
	});

	it('passes a real value through untouched', async () => {
		assert.deepStrictEqual(await parsed(z.object({ timeout_ms: z.number().optional() }), { timeout_ms: 30_000 }), {
			timeout_ms: 30_000,
		});
	});

	it('applies a .default() factory freshly on every parse', async () => {
		// Reading defaultValue() once at transform time handed every parse the same
		// array instance, so a handler that pushed into it accumulated across steps.
		const schema = z.object({ tags: z.array(z.string()).optional().default([]) });
		const first = (await parsed(schema, {})) as { tags: string[] };
		const second = (await parsed(schema, {})) as { tags: string[] };
		assert.notStrictEqual(first.tags, second.tags);
	});

	it('keeps a refinement that inspects which keys are present', async () => {
		// Filling the omitted key with null left it present-with-undefined on the
		// parsed object, so `Object.keys(v).length` and `'x' in v` predicates saw
		// keys the model never sent and rejected valid responses.
		const schema = z
			.object({ a: z.string(), b: z.number().optional() })
			.refine((v) => Object.keys(v).length === 1, 'only a');
		assert.deepStrictEqual(await parsed(schema, { a: 'y' }), { a: 'y' });
		assert.deepStrictEqual(await parsed(schema, { a: 'y', b: null }), { a: 'y' });
	});

	it('keeps a refinement enforcing its rule', async () => {
		const schema = z.object({ a: z.string() }).refine((v) => v.a !== 'no', 'bad a');
		assert.strictEqual((await validate(schema, { a: 'no' })).success, false);
		assert.strictEqual((await validate(schema, { a: 'yes' })).success, true);
	});

	it('still rejects a value of the wrong type', async () => {
		assert.strictEqual((await validate(z.object({ element_index: z.number() }), { element_index: 'first' })).success, false);
	});

	it('still reports a genuinely required key as missing', async () => {
		const result = await validate(z.object({ a: z.number(), b: z.number().optional() }), {});
		assert.strictEqual(result.success, false);
		assert.deepStrictEqual(
			result.success ? [] : (result.error as z.ZodError).issues.map((issue) => issue.path.join('.')),
			['a'],
		);
	});
});

describe('toStrictOutputSchema still tolerates keys a response omits', () => {
	// Only OpenAI enforces the submitted schema during decoding. generateAction
	// sends the same schema to a model chain that also holds Gemini and Anthropic,
	// which honour `required` by convention — a response that simply leaves
	// `thought` out has always parsed via the default and must keep doing so, or a
	// good action fails with "did not match any known action schema".
	it('applies the default when a defaulted key is missing entirely', async () => {
		const schema = z.object({
			thought: z.string().optional().default(''),
			action: z.object({ click: z.object({ element_index: z.number() }) }),
		});
		assert.deepStrictEqual(await parsed(schema, { action: { click: { element_index: 1 } } }), {
			thought: '',
			action: { click: { element_index: 1 } },
		});
	});

	it('tolerates a missing optional key nested inside the action union', async () => {
		const schema = z.object({
			action: z.union([
				z.object({ click: z.object({ element_index: z.number(), timeout_ms: z.number().optional() }) }),
				z.object({ scroll: z.object({ delta_y: z.number().optional() }) }),
			]),
		});
		assert.deepStrictEqual(await parsed(schema, { action: { click: { element_index: 2 } } }), {
			action: { click: { element_index: 2 } },
		});
	});

	it('tolerates an optional key hidden behind another wrapper', async () => {
		// Promotion used to be decided by `instanceof ZodOptional` on the shape
		// entry, so `.optional().nullable()` was rebuilt into a node that rejected
		// undefined while never being recorded for filling.
		const schema = z.object({ a: z.number(), b: z.number().optional().nullable() });
		assert.deepStrictEqual(await parsed(schema, { a: 1 }), { a: 1 });
	});

	it('reports the real type error when the value is not an object at all', async () => {
		const result = await validate(z.object({ timeout_ms: z.number().optional() }), 'not an object');
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.success ? '' : (result.error as z.ZodError).issues[0].code, 'invalid_type');
	});
});

describe('toStrictOutputSchema handles unions without destroying data', () => {
	it('strips injected nulls inside an array that sits under a union branch', async () => {
		// The array walk read `promoted.items` of the current node and returned
		// before the branch walk ran, so nulls injected into an array under an
		// anyOf were never undone and the model's own conformant answer was rejected.
		const schema = z.object({
			paths: z.union([z.string(), z.array(z.object({ p: z.string(), alt: z.string().optional() }))]),
		});
		assert.deepStrictEqual(await parsed(schema, { paths: [{ p: 'x', alt: null }] }), {
			paths: [{ p: 'x' }],
		});
	});

	it('keeps a null that one branch requires while another leaves the key optional', async () => {
		// Applying every branch's promotions deleted `v` for a value that matched
		// the branch where `v: null` is a legal, meaningful value.
		const schema = z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('a'), v: z.number().optional() }),
			z.object({ kind: z.literal('b'), v: z.number().nullable() }),
		]);
		assert.deepStrictEqual(await parsed(schema, { kind: 'b', v: null }), { kind: 'b', v: null });
	});

	it('still strips when every branch declaring the key promotes it', async () => {
		const schema = z.union([
			z.object({ kind: z.literal('a'), v: z.number().optional() }),
			z.object({ kind: z.literal('b'), v: z.number().optional() }),
		]);
		assert.deepStrictEqual(await parsed(schema, { kind: 'a', v: null }), { kind: 'a' });
	});
});

describe('toStrictOutputSchema respects schemas that already accept null', () => {
	it('does not strip a null from z.any() / z.unknown()', async () => {
		// `{}` — what zodToJsonSchema emits for these — accepts every instance,
		// null included, so the documented "only strip where the source would
		// reject null" rule says leave it alone.
		assert.deepStrictEqual(await parsed(z.object({ done: z.any() }), { done: null }), { done: null });
		assert.deepStrictEqual(await parsed(z.object({ meta: z.unknown() }), { meta: null }), { meta: null });
	});

	it('does not substitute the default for a deliberate null', async () => {
		// The sharpest form: stripping turned the model's null into 'DEFAULT'.
		assert.deepStrictEqual(await parsed(z.object({ done: z.any().default('DEFAULT') }), { done: null }), {
			done: null,
		});
	});
});

describe('toStrictOutputSchema widens literals in a form that actually permits null', () => {
	it('routes a const through anyOf rather than a type array', () => {
		// `{type: ['string','null'], const: 'a'}` still rejects null — const is an
		// assertion on the instance — so the model had no way to signal absence.
		const json = jsonOf(z.object({ kind: z.literal('a').optional() }));
		const kind = json.properties?.kind as { type?: unknown; const?: unknown };
		assert.ok(
			!(Array.isArray(kind.type) && kind.const !== undefined),
			`literal widened to a self-contradictory schema: ${JSON.stringify(kind)}`,
		);
	});

	it('lets null signal absence for an optional literal', async () => {
		assert.deepStrictEqual(await parsed(z.object({ kind: z.literal('a').optional() }), { kind: null }), {});
	});

	it('drops `default` even when the value is widened with anyOf', () => {
		// The strip ran after widening, so it looked for `default` at the top level
		// when the node had already moved inside an anyOf branch.
		const json = jsonOf(z.object({ mode: z.enum(['a', 'b']).default('a').optional() }));
		assert.ok(
			!JSON.stringify(json.properties?.mode).includes('"default"'),
			`default survived: ${JSON.stringify(json.properties?.mode)}`,
		);
	});
});

describe('toStrictOutputSchema keeps the model guidance intact', () => {
	it('preserves descriptions written before .optional()', () => {
		const json = jsonOf(z.object({ new_tab: z.boolean().describe('Open in a new tab').optional() }));
		assert.strictEqual(json.properties?.new_tab.description, 'Open in a new tab');
	});

	it('preserves descriptions written after .optional()', () => {
		const json = jsonOf(z.object({ timeout_ms: z.number().optional().describe('Per-action timeout in ms.') }));
		assert.strictEqual(json.properties?.timeout_ms.description, 'Per-action timeout in ms.');
	});

	it('does not inject guidance of its own', () => {
		// A blanket "return null unless the instruction specifies a value" hint made
		// the model null out scroll_on_element's delta_x/delta_y, which `|| 0` turned
		// into page.mouse.wheel(0, 0) — a scroll that reported success and did
		// nothing. Field-level guidance belongs in the field's own .describe().
		const json = jsonOf(z.object({ delta_y: z.number().optional().describe('Pixels to scroll vertically.') }));
		assert.strictEqual(json.properties?.delta_y.description, 'Pixels to scroll vertically.');
	});

	it('keeps the description on the outer node when it has to widen with anyOf', () => {
		const json = jsonOf(z.object({ mode: z.enum(['a', 'b']).optional().describe('Which mode.') }));
		assert.strictEqual(json.properties?.mode.description, 'Which mode.');
	});
});

describe('toStrictOutputSchema does not depend on the caller sharing our Zod', () => {
	it('works on a schema whose nodes fail instanceof against our Zod copy', () => {
		// @shiplightai/sdk depends on zod as a normal dependency, so a consumer app
		// with its own zod builds Agent.registerAction schemas from a second copy.
		// Zod-level dispatch silently returned those untouched. zodToJsonSchema
		// reads _def.typeName strings, so the JSON-level transform is unaffected —
		// simulated here with a hand-built node that is not one of our instances.
		const foreign = Object.create(null) as Record<string, unknown>;
		Object.assign(foreign, z.object({ target: z.string(), timeout_ms: z.number().optional() }));
		Object.setPrototypeOf(foreign, Object.getPrototypeOf({}));
		assert.strictEqual(foreign instanceof z.ZodObject, false);

		const json = toStrictJsonSchema(foreign as unknown as z.ZodTypeAny) as JsonSchemaNode;
		assert.deepStrictEqual(json.required, ['target', 'timeout_ms']);
		assert.deepStrictEqual(validateStrictMode(json), []);
	});
});
