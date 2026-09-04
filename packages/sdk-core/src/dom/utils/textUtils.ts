/**
 * Text utility functions for DOM processing
 */

/**
 * Cap text length with ellipsis
 */
export function capTextLength(text: string, maxLength: number): string {
	if (text.length > maxLength) {
		return text.slice(0, maxLength) + '...';
	}
	return text;
}
