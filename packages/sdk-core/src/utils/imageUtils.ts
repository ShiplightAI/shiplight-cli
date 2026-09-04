/**
 * Image utilities for screenshot processing
 */

async function getSharp() {
	const { default: sharp } = await import('sharp');
	return sharp;
}

const TILE_SIZE = 768;

/**
 * Default label dimensions for hot map generation
 * Based on typical label size: ~8px per digit + padding
 */
const DEFAULT_LABEL_WIDTH = 26;
const DEFAULT_LABEL_HEIGHT = 22;

export interface SliceScreenshotOptions {
	/** Resize each patch to 768x768 for token optimization */
	resize?: boolean;
}

/**
 * Slice a screenshot into 3 overlapping square patches (left, middle, right)
 *
 * Creates three height x height square patches that overlap horizontally
 * to cover the full width of the image. This maximizes token usage while
 * ensuring no information is lost.
 *
 * For a 1920x1080 image: creates three 1080x1080 overlapping patches
 * With resize=true: patches are resized to 768x768
 *
 * @param imageBuffer - Screenshot image as Buffer
 * @param options - Slicing options (resize, etc.)
 * @returns Array of 3 image buffers [left, middle, right]
 */
export async function sliceScreenshot(imageBuffer: Buffer, options?: SliceScreenshotOptions): Promise<Buffer[]> {
	const sharp = await getSharp();
	const image = sharp(imageBuffer);
	const metadata = await image.metadata();

	const width = metadata.width || 0;
	const height = metadata.height || 0;

	if (width === 0 || height === 0) {
		throw new Error('Invalid image dimensions');
	}

	// Patch size is the full height (creates square patches)
	const patchSize = height;

	// Calculate starting positions for overlapping patches
	// Left: start from left edge
	const leftStart = 0;
	// Middle: centered
	const middleStart = Math.floor((width - patchSize) / 2);
	// Right: aligned to right edge
	const rightStart = Math.max(0, width - patchSize);

	// Helper to create a patch (extract and optionally resize)
	const createPatch = (left: number, extractWidth: number) => {
		let pipeline = sharp(imageBuffer)
			.extract({ left, top: 0, width: extractWidth, height: patchSize });

		if (options?.resize) {
			pipeline = pipeline.resize(TILE_SIZE, TILE_SIZE);
		}

		return pipeline.png().toBuffer();
	};

	// Crop the three overlapping regions
	const [leftCrop, middleCrop, rightCrop] = await Promise.all([
		createPatch(leftStart, Math.min(patchSize, width)),
		createPatch(middleStart, Math.min(patchSize, width - middleStart)),
		createPatch(rightStart, Math.min(patchSize, width - rightStart)),
	]);

	return [leftCrop, middleCrop, rightCrop];
}

/**
 * Slice a base64 screenshot into 3 square regions
 *
 * @param base64Image - Screenshot as base64 string (without data URL prefix)
 * @returns Array of 3 base64 strings [left, middle, right]
 */
export async function sliceScreenshotBase64(base64Image: string): Promise<string[]> {
	const imageBuffer = Buffer.from(base64Image, 'base64');
	const slices = await sliceScreenshot(imageBuffer);
	return slices.map(slice => slice.toString('base64'));
}

/**
 * Raw pixel data from an image
 */
export interface RawPixelData {
	/** Raw RGBA pixel data */
	data: Uint8Array;
	/** Image width in pixels */
	width: number;
	/** Image height in pixels */
	height: number;
}

/**
 * Options for hot map generation
 */
export interface HotMapOptions {
	/** Width of the label in pixels (default: 24) */
	labelWidth?: number;
	/** Height of the label in pixels (default: 16) */
	labelHeight?: number;
}

/**
 * Extract raw RGBA pixel data from a PNG buffer using sharp
 *
 * @param pngBuffer - PNG image as Buffer
 * @returns Raw RGBA pixel data with dimensions
 */
export async function pngToRawPixels(pngBuffer: Buffer): Promise<RawPixelData> {
	const sharp = await getSharp();
	const image = sharp(pngBuffer);
	const metadata = await image.metadata();

	const width = metadata.width || 0;
	const height = metadata.height || 0;

	if (width === 0 || height === 0) {
		throw new Error('Invalid image dimensions');
	}

	// Extract raw RGBA pixel data
	const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

	return {
		data: new Uint8Array(data),
		width,
		height,
	};
}

/**
 * Default tolerance for color comparison in isPatchUniform
 * Allows for slight color variations (e.g., anti-aliasing, compression artifacts)
 */
const DEFAULT_COLOR_TOLERANCE = 32;

/**
 * Check if a patch of pixels is uniform (all similar color within tolerance)
 *
 * @param data - Raw RGBA pixel data
 * @param width - Image width
 * @param height - Image height
 * @param startX - Starting X coordinate of patch
 * @param startY - Starting Y coordinate of patch
 * @param patchWidth - Width of patch to check
 * @param patchHeight - Height of patch to check
 * @param tolerance - Maximum allowed difference per RGB channel (default: 32)
 * @returns true if all pixels in patch are within tolerance of reference color
 */
function isPatchUniform(
	data: Uint8Array,
	width: number,
	height: number,
	startX: number,
	startY: number,
	patchWidth: number,
	patchHeight: number,
	tolerance: number = DEFAULT_COLOR_TOLERANCE
): boolean {
	// Handle edge cases - treat out-of-bounds as non-uniform
	if (startX + patchWidth > width || startY + patchHeight > height) {
		return false;
	}
	if (startX < 0 || startY < 0) {
		return false;
	}

	// Get reference color from first pixel (RGBA format, 4 bytes per pixel)
	const refIdx = (startY * width + startX) * 4;
	const refR = data[refIdx];
	const refG = data[refIdx + 1];
	const refB = data[refIdx + 2];

	// Check all pixels in patch
	for (let dy = 0; dy < patchHeight; dy++) {
		for (let dx = 0; dx < patchWidth; dx++) {
			const idx = ((startY + dy) * width + (startX + dx)) * 4;
			const diffR = Math.abs(data[idx] - refR);
			const diffG = Math.abs(data[idx + 1] - refG);
			const diffB = Math.abs(data[idx + 2] - refB);
			if (diffR > tolerance || diffG > tolerance || diffB > tolerance) {
				return false; // Not uniform within tolerance
			}
		}
	}

	return true; // All pixels within tolerance
}

/**
 * Generate a hot map indicating valid label positions
 *
 * Creates a 2D boolean array where each cell indicates whether a label
 * with its top-left corner at that position would be over a uniform color patch.
 * This is used for finding good positions to place numbered labels.
 *
 * Algorithm: Convolution with a kernel the size of the expected label.
 * If all pixels in the kernel-sized patch are the same color, that position is "hot" (true).
 *
 * @param pixelData - Raw RGBA pixel data from screenshot
 * @param options - Label dimensions for kernel size
 * @returns 2D boolean array where hotMap[y][x] = true means safe to place label at (x, y)
 */
export function generateHotMap(pixelData: RawPixelData, options?: HotMapOptions): boolean[][] {
	const { data, width, height } = pixelData;
	const labelWidth = options?.labelWidth ?? DEFAULT_LABEL_WIDTH;
	const labelHeight = options?.labelHeight ?? DEFAULT_LABEL_HEIGHT;

	const hotMap: boolean[][] = [];

	// For each pixel position
	for (let y = 0; y < height; y++) {
		hotMap[y] = [];
		for (let x = 0; x < width; x++) {
			// Check if kernel-sized patch starting at (x, y) is uniform color
			hotMap[y][x] = isPatchUniform(data, width, height, x, y, labelWidth, labelHeight);
		}
	}

	return hotMap;
}

/**
 * Generate hot map from a PNG buffer (convenience function)
 *
 * @param pngBuffer - PNG image as Buffer
 * @param options - Label dimensions for kernel size
 * @returns 2D boolean array for label placement
 */
export async function generateHotMapFromPng(pngBuffer: Buffer, options?: HotMapOptions): Promise<boolean[][]> {
	const pixelData = await pngToRawPixels(pngBuffer);
	return generateHotMap(pixelData, options);
}

/**
 * Grayscale image data
 */
export interface GrayscaleImageData {
	/** 2D array of grayscale pixel values (0-255) */
	pixels: number[][];
	/** Image width in pixels */
	width: number;
	/** Image height in pixels */
	height: number;
}

/**
 * Generate a grayscale image from a PNG buffer
 *
 * This is used for dynamic label placement with convolution at placement time.
 * Instead of pre-computing a boolean hot map with fixed kernel size, we return
 * the raw grayscale image and perform uniformity checks with dynamic label sizes.
 *
 * @param pngBuffer - PNG image as Buffer
 * @returns Grayscale image as 2D number array where pixels[y][x] is intensity 0-255
 */
export async function generateGrayscaleFromPng(pngBuffer: Buffer): Promise<GrayscaleImageData> {
	const sharp = await getSharp();
	const image = sharp(pngBuffer);
	const metadata = await image.metadata();

	const width = metadata.width || 0;
	const height = metadata.height || 0;

	if (width === 0 || height === 0) {
		throw new Error('Invalid image dimensions');
	}

	// Convert to grayscale and extract raw pixel data
	const { data } = await image.grayscale().raw().toBuffer({ resolveWithObject: true });

	// Convert flat Uint8Array to 2D array
	const pixels: number[][] = [];
	for (let y = 0; y < height; y++) {
		pixels[y] = [];
		for (let x = 0; x < width; x++) {
			pixels[y][x] = data[y * width + x];
		}
	}

	return { pixels, width, height };
}
