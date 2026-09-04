/**
 * Every action tool schema must reach the model in a form OpenAI strict
 * structured outputs accepts.
 *
 * Each tool schema is wrapped as `{ toolName: schema }` and combined into the
 * `action` union that `generateAction` submits, so ONE strict-invalid member
 * fails the whole request — the API rejects it before the model is consulted
 * and the AI fallback cannot rescue anything:
 *
 *   AI_APICallError: Invalid schema for response_format 'response':
 *   In context=('properties','action','anyOf','0','properties','click'),
 *   'required' is required to be supplied and to be an array including every
 *   key in properties. Missing 'timeout_ms'.
 *
 * The fix is `toStrictOutputSchema` at the submission boundary, not a rewrite
 * of the schemas below: these same Zod objects validate replayed
 * `action_data.kwargs` and MCP `act` payloads, which legitimately omit optional
 * keys. So this test asserts two things per schema — strict-valid once
 * transformed, and still tolerant of an omitted optional key in its raw form.
 *
 * Schemas are discovered from disk rather than listed, so a new action with a
 * `.optional()` field is covered the day it lands.
 */

import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { validateStrictMode } from '../../llm_tools/schema';
import { toStrictJsonSchema } from '../../llm_tools/strictSchema';

const IMPL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'impl');

/**
 * `perform_accurate_operation.ts` reaches the DOM service, which imports the
 * bundled dom-tree with a `?raw` query that only the tsup build resolves — this
 * runner cannot import it at all. It is the one action module not covered here;
 * the assertion below fails if anything else joins it, so the gap cannot grow
 * silently.
 */
const UNIMPORTABLE = new Set(['perform_accurate_operation.ts']);

async function collectToolSchemas(): Promise<Array<[string, z.ZodTypeAny]>> {
	const files = readdirSync(IMPL_DIR)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
		.sort();

	const found: Array<[string, z.ZodTypeAny]> = [];
	const failed: string[] = [];

	for (const file of files) {
		if (UNIMPORTABLE.has(file)) continue;
		let mod: Record<string, unknown>;
		try {
			mod = (await import(join(IMPL_DIR, file))) as Record<string, unknown>;
		} catch (error) {
			failed.push(`${file}: ${(error as Error).message.split('\n')[0]}`);
			continue;
		}
		for (const [name, value] of Object.entries(mod)) {
			if (name.endsWith('ToolSchema') && value instanceof z.ZodType) {
				found.push([`${file.replace(/\.ts$/, '')}.${name}`, value as z.ZodTypeAny]);
			}
		}
	}

	assert.deepStrictEqual(
		failed,
		[],
		`these action modules could not be imported, so their tool schemas went unchecked — ` +
			`fix the import or add the file to UNIMPORTABLE with a reason: ${failed.join(', ')}`,
	);
	return found;
}

const TOOL_SCHEMAS = await collectToolSchemas();

/** A field's description, wherever `.describe()` was applied in the wrapper chain. */
function describedText(field: z.ZodTypeAny): string | undefined {
	let node: z.ZodTypeAny | undefined = field;
	while (node) {
		const def = node._def as { description?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };
		if (def.description) return def.description;
		node = def.innerType ?? def.schema;
	}
	return undefined;
}

describe('action tool schemas are strict-valid once submitted', () => {
	it('discovers the action tool schemas on disk', () => {
		// A glob that quietly matches nothing would make every assertion below
		// vacuous, which is how this class of bug shipped in the first place.
		assert.ok(
			TOOL_SCHEMAS.length >= 20,
			`expected to discover the action tool schemas in ${IMPL_DIR}, found ${TOOL_SCHEMAS.length}`,
		);
	});

	for (const [name, schema] of TOOL_SCHEMAS) {
		it(`${name}: every property is listed in required as submitted`, () => {
			// Wrapped exactly as ToolRegistry.buildActionUnionSchema wraps it, so a
			// failure path here matches the path the API reports.
			const wrapped = z.object({ [name]: schema });
			const errors = validateStrictMode(toStrictJsonSchema(wrapped));

			assert.deepStrictEqual(
				errors,
				[],
				`${name} is not strict-valid even after toStrictOutputSchema, so submitting ` +
					`the action union would fail the whole request. z.record() is the known ` +
					`construct that cannot be expressed under strict mode at all. ` +
					`Errors: ${errors.join('; ')}`,
			);
		});
	}

	for (const [name, schema] of TOOL_SCHEMAS) {
		it(`${name}: no description tells a caller to send null`, () => {
			// These descriptions are part of the shared schema, so they reach the MCP
			// `act` tool definition too (browserTools.getActToolDefinition), where the
			// field is plain optional and NOT nullable. A client that followed a
			// "return null" instruction got `Expected number, received null` from
			// ToolRegistry.execute. Nullability is a property of the strict
			// submission view only — never advertise it on the shared schema.
			if (!(schema instanceof z.ZodObject)) return;
			const shape = schema._def.shape() as z.ZodRawShape;

			const offenders: string[] = [];
			for (const [key, field] of Object.entries(shape)) {
				const description = describedText(field);
				if (description && /\bnull\b/i.test(description)) offenders.push(`${key}: ${description}`);
			}

			assert.deepStrictEqual(
				offenders,
				[],
				`${name} advertises null to callers of a non-nullable field — the MCP act ` +
					`path parses with this raw schema and rejects null: ${offenders.join(' | ')}`,
			);
		});
	}

	for (const [name, schema] of TOOL_SCHEMAS) {
		it(`${name}: raw schema still accepts arguments that omit optional keys`, () => {
			// ToolRegistry.execute() parses replayed kwargs and MCP `act` payloads
			// with the raw schema. Making an optional field mandatory to satisfy
			// strict mode — the obvious .optional() -> .nullable() rewrite — would
			// break both paths.
			if (!(schema instanceof z.ZodObject)) return;
			const shape = schema._def.shape() as z.ZodRawShape;
			const optionalKeys = new Set(
				Object.entries(shape)
					.filter(([, field]) => field.isOptional())
					.map(([key]) => key),
			);
			if (optionalKeys.size === 0) return;

			// Parse an empty payload and ignore complaints about the genuinely
			// required fields — the only question is whether omitting an OPTIONAL
			// key is itself an error. Asserting it this way avoids synthesising
			// values for constrained fields (`date` carries a format regex).
			const result = schema.safeParse({});
			const complaints = result.success
				? []
				: result.error.issues
						.filter((issue) => optionalKeys.has(String(issue.path[0])))
						.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

			assert.deepStrictEqual(
				complaints,
				[],
				`${name} rejects arguments that omit its optional keys — replayed action ` +
					`kwargs and MCP act payloads do not send them: ${complaints.join(', ')}`,
			);
		});
	}
});
