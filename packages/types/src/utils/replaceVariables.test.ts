/**
 * Variable substitution tests (001 FR-008).
 *
 * The headline case is re-substitution: the original implementation ran four
 * sequential `String.replace` passes, so a value produced by an earlier pass
 * was still visible to a later one. A password like `P$word` substituted from
 * `{{pw}}` was then rescanned by the `$varName` pass and silently mutated if a
 * variable named `word` happened to exist. Credentials are the main carrier of
 * `$`, which is what makes this a correctness bug rather than a curiosity.
 *
 * The fix is a single left-to-right pass over one alternation, which never
 * rescans what it has already written.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replaceVariables } from './replaceVariables';

describe('replaceVariables — supported syntaxes', () => {
  it('substitutes {{ var }}, with or without spaces or a $ prefix', () => {
    const vars = { name: 'Ada' };
    assert.equal(replaceVariables('hi {{name}}', vars), 'hi Ada');
    assert.equal(replaceVariables('hi {{ name }}', vars), 'hi Ada');
    assert.equal(replaceVariables('hi {{ $name }}', vars), 'hi Ada');
  });

  it('substitutes ${var} and $var', () => {
    const vars = { name: 'Ada' };
    assert.equal(replaceVariables('hi ${name}', vars), 'hi Ada');
    assert.equal(replaceVariables('hi $name', vars), 'hi Ada');
  });

  it('substitutes the legacy <secret> form', () => {
    assert.equal(replaceVariables('pw=<secret>pw</secret>', { pw: 's3cr3t' }), 'pw=s3cr3t');
    assert.equal(replaceVariables('pw=<secret>$pw</secret>', { pw: 's3cr3t' }), 'pw=s3cr3t');
  });

  it('accepts variables stored with or without the $ prefix, and a Map', () => {
    assert.equal(replaceVariables('$a', { $a: '1' }), '1');
    assert.equal(replaceVariables('$a', new Map([['a', '1']])), '1');
  });

  it('leaves an unmatched variable verbatim', () => {
    assert.equal(replaceVariables('{{nope}} $nope ${nope}', {}), '{{nope}} $nope ${nope}');
  });

  it('stringifies non-string values but treats null/undefined as unset', () => {
    assert.equal(replaceVariables('n={{n}}', { n: 42 }), 'n=42');
    assert.equal(replaceVariables('n={{n}}', { n: false }), 'n=false');
    assert.equal(replaceVariables('n={{n}}', { n: null }), 'n={{n}}');
  });

  it('passes through non-string input untouched', () => {
    assert.equal(replaceVariables('', { a: '1' }), '');
    assert.equal(replaceVariables(undefined as unknown as string, { a: '1' }), undefined);
  });
});

describe('replaceVariables — substituted values are never re-substituted', () => {
  it('does not rescan a {{ }} value that contains $ident', () => {
    // The regression: pass 1 wrote `P$word`, pass 4 then rewrote it to `PZZZ`.
    const out = replaceVariables('{{pw}}', { pw: 'P$word', word: 'ZZZ' });
    assert.equal(out, 'P$word');
  });

  it('does not rescan a <secret> value that contains $ident', () => {
    const out = replaceVariables('<secret>pw</secret>', { pw: 'a$b', b: 'X' });
    assert.equal(out, 'a$b');
  });

  it('does not rescan a ${ } value that contains $ident', () => {
    const out = replaceVariables('${pw}', { pw: 'a$b', b: 'X' });
    assert.equal(out, 'a$b');
  });

  it('does not rescan a value that itself looks like a {{ }} placeholder', () => {
    const out = replaceVariables('{{outer}}', { outer: '{{inner}}', inner: 'BOOM' });
    assert.equal(out, '{{inner}}');
  });

  it('leaves a literal $ident in the TEXT substitutable — only values are protected', () => {
    // The fix must not break the ordinary case: placeholders in the input are
    // still resolved, including several of different syntaxes in one string.
    const out = replaceVariables('$a-{{b}}-${c}', { a: '1', b: '2', c: '3' });
    assert.equal(out, '1-2-3');
  });

  it('keeps a doubled $$ prefix intact while resolving the placeholder after it', () => {
    assert.equal(replaceVariables('$${a}', { a: 'V' }), '$V');
  });
});
