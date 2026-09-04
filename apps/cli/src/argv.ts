// Shared argv helpers for value-taking CLI flags.
//
// Every command that accepts `--flag value` needs the same walk: recognise both
// spellings, pull the flag and its value out, and hand back what is left so the
// command's own path/positional handling never sees them. Hand-rolling that per
// command produced two copies that disagreed on when a value counts as missing,
// so `shiplight report` and `shiplight test` treated the same argv differently.

/** One occurrence of a value-taking flag on the command line. */
export interface FlagOccurrence {
  /** The value given, or `undefined` when the flag was written without one. */
  value?: string;
  /** True for the `--flag=value` spelling, false for `--flag value`. */
  inline: boolean;
}

/**
 * Pull every occurrence of `flag` out of `argv`, supporting `--flag value` and
 * `--flag=value`.
 *
 * A token starting with `-` is never taken as a value. `-o` and `--open` are
 * flags this CLI actually has, and swallowing one would silently drop it; such
 * an occurrence is reported as a missing value and the token stays in
 * `remaining` so the flag it belongs to is still honored. To pass a value that
 * really does start with a dash, use the `--flag=-value` spelling.
 *
 * Callers decide policy — `shiplight test` throws on a missing value while
 * `shiplight report` warns and falls back — so every occurrence is returned in
 * command-line order rather than being reduced to a single winner here.
 */
export function takeFlagValues(
  argv: string[],
  flag: string,
): { occurrences: FlagOccurrence[]; remaining: string[] } {
  const inlinePrefix = `${flag}=`;
  const occurrences: FlagOccurrence[] = [];
  const remaining: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === flag) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        occurrences.push({ inline: false });
      } else {
        occurrences.push({ value: next, inline: false });
        i++;
      }
      continue;
    }

    if (arg.startsWith(inlinePrefix)) {
      occurrences.push({ value: arg.slice(inlinePrefix.length), inline: true });
      continue;
    }

    remaining.push(arg);
  }

  return { occurrences, remaining };
}

/**
 * Whether an argv token is a flag rather than a path.
 *
 * Both dash counts matter: `--merge` and `-o` are equally not directories. A
 * report folder or shard directory that genuinely starts with a dash has to be
 * written as `./-name`, the same convention every other CLI uses.
 */
export function looksLikeFlag(arg: string): boolean {
  return arg.startsWith('-');
}
