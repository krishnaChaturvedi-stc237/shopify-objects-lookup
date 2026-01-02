import * as vscode from 'vscode';
const shopifyData = require('./shopify-data.json');

export function activate(context: vscode.ExtensionContext) {
	// This will now show up in your DEBUG CONSOLE
	console.log('SHOPIFY EXTENSION DEPLOYED SUCCESSFULLY');

	const provider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: '*' }, // Temporary: Allow ALL file types for testing
		{
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				const linePrefix = document.lineAt(position).text.substr(0, position.character);
				// Debugging: This will show what you're typing in the console
				console.log('Current line prefix:', linePrefix);

				// Get the word before the dot
				// Example: "product." -> ["product", ""] -> objectName is "product"
				// Pattern 1: User typed "obj." (Nested Suggestions)
				if (linePrefix.endsWith('.')) {
					const parts = linePrefix.trim().split(/[ .|{}]+/);
                    console.log('Parts after split:', parts);
					const objectName = parts[parts.length - 2];

					console.log('Final Object Detected:', objectName);

					const foundObj = (shopifyData as any)[objectName];

					if (foundObj && foundObj.properties) {
						console.log(`Success: Found ${Object.keys(foundObj.properties).length} properties for ${objectName}`);
						return createCompletionItems(foundObj.properties, foundObj.link, objectName);
					} else {
					    console.log(`No data found for object: "${objectName}"`);
				    }
				}
				

				// Pattern 2: User is typing an object name (Global Suggestions)
				// If the line is empty or just started, suggest the main objects
				// Pattern 2: User is typing an object name
				if (linePrefix.trim().length > 0 && !linePrefix.includes('.')) {
					return Object.keys(shopifyData).map(key => {
						const obj = (shopifyData as any)[key];
						const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Class);

						item.detail = "Shopify Global Object";

						const docs = new vscode.MarkdownString();
						docs.appendMarkdown(`## 📦 ${key}\n`);
						docs.appendMarkdown(`---\n`);
						docs.appendMarkdown(`${obj.description}\n\n`);
						docs.appendMarkdown(`[📚 Open Documentation](${obj.link})`);

						item.documentation = docs;
						return item;
					});
				}

				return undefined;
			}
		},
		'.' // Trigger character
	);

	context.subscriptions.push(provider);
}

// Helper to convert our JSON properties to VS Code Completion Items
function createCompletionItems(properties: any, baseLink: string, objectName: string) {
	/*
	"properties": {
	   "title": { "description": "The title of the product.", "link": "#title" },
	   "handle": { "description": "The unique handle of the product.", "link": "#handle" },
	}
	*/
    return Object.keys(properties).map(key => {
        const prop = properties[key];
        
        // 1. Choose a different icon if it leads to another object (Nesting)
        const itemKind = prop.type 
            ? vscode.CompletionItemKind.Struct  // Icon for objects
            : vscode.CompletionItemKind.Field;  // Icon for plain properties

        const item = new vscode.CompletionItem(key, itemKind);

        // 2. The 'Detail' appears right next to the name in the list
        item.detail = prop.type ? `(Object: ${prop.type})` : `(Property)`;

        // 3. The Documentation (Fly-out window)
        const docs = new vscode.MarkdownString();
        
        // Header with Bold Name
        docs.appendMarkdown(`### 🏷️ ${key}\n`);
        
        // Horizontal Rule
        docs.appendMarkdown(`---\n`);

        // Description
        docs.appendMarkdown(`${prop.description}\n\n`);

        // Usage Example (Code Block)
        docs.appendMarkdown(`**Usage:**\n`);
        docs.appendCodeblock(`{{ ${objectName}.${key} }}`, 'liquid');

        // Link with an Emoji
        docs.appendMarkdown(`\n\n---\n[🔗 View Shopify Reference](${baseLink}${prop.link})`);

        // Allow links to be clickable
        docs.isTrusted = true;

        item.documentation = docs;

        return item;
    });
}

export function deactivate() { }