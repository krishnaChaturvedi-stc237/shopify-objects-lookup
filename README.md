# 🛍️ Shopify Objects Lookup (Pro)

The ultimate context-aware IntelliSense companion for Shopify 2.0 Theme Development. Stop guessing which objects are available in your sections and snippets.

## 🚀 Key Features

- **Context-Aware Discovery**: Type `objs:` to see a categorized list of exactly what Liquid objects are available in your current file.
  - ✅ **Verified**: 100% safe objects found in your theme's templates.
  - ⚠️ **Potential**: Objects that require specific template context to work.
  - 🌍 **Global**: Standard Shopify objects available everywhere.
- **Instant Schema Reference**: Type any object name followed by a colon (e.g., `product:`) to instantly paste a full JSON-style documentation block into your code as a comment.
- **Deep Nesting Support**: Full support for Shopify 2.0 objects including Products, Collections, Metaobjects, and Predictive Search.
- **Rich Documentation**: Hover over any property to see descriptions, mock values, and direct links to official Shopify documentation.

## 📖 How to Use

### 1. The Context Map
Type `objs:` anywhere in a `.liquid` file. 
The extension will scan your `templates/*.json` and `sections/*.json` to tell you what's "legally" accessible.

### 2. The Cheat Sheet
Type `product:` (or any object name) and hit Enter.
It will paste a formatted comment block with all properties and mock data for offline reference.

### 3. IntelliSense
Simply type `product.` to see all properties with documentation hovers.

## 🛠️ Supported Contexts
- **Sections**: Automatically detects usage in JSON templates.
- **Snippets**: Recursively finds parent sections to determine object availability.
- **Metaobjects**: Full support for the new Shopify Metaobject templates.
- **Predictive Search**: Specialized support for the AJAX search API context.

---
**Developed with ❤️ by Krishna Chaturvedi**