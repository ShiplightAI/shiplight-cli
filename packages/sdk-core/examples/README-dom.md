# DOM Extraction Example

## Running the Example

### Extract DOM and Screenshot

```bash
cd <repo-root>/examples/sdk-examples

# Extract DOM from a URL
tsx extractDom.ts <url> <output_dir>

# Example:
tsx extractDom.ts https://github.com/login /tmp/github_login
```

**What it does:**
- Opens the URL in a browser
- Extracts all clickable elements with numbered highlights
- Captures a screenshot with the highlights visible
- Saves `dom.txt` and `screenshot.png` to the output directory

**Output:**
```
🚀 Starting DOM extraction for: https://github.com/login
📁 Output directory: /tmp/github_login
🌐 Navigating to https://github.com/login
🔍 Extracting clickable elements...
✅ Found 13 clickable elements
💾 DOM saved to: /tmp/github_login/dom.txt
💾 Screenshot saved to: /tmp/github_login/screenshot.png

============================================================
✅ Extraction complete!
   Elements found: 13
   DOM file: /tmp/github_login/dom.txt
   Screenshot: /tmp/github_login/screenshot.png
============================================================
```

## Tips

- Examples run with **headless: false** so you can see the highlights
- Browser stays open for 3 seconds to let you see the result
- Press Ctrl+C to stop early if needed

---

## Testing and Comparison

For testing and comparing DOM extraction implementations, see:

**📁 `<repo-root>/local_tests/dom_extraction/`**

This directory contains independent testing tools:
- `compare_outputs.py` - Compare any two DOM extraction outputs
- `test_implementations.sh` - Run both Python and TypeScript, then compare
- `README.md` - Complete testing guide

These tools are kept separate because they're implementation-agnostic and used for validation, not production code.

### Quick Start

```bash
# Test both implementations
cd <repo-root>/local_tests/dom_extraction
./test_implementations.sh https://github.com/login
```

See the [testing guide](<repo-root>/local_tests/dom_extraction/README.md) for complete documentation.
