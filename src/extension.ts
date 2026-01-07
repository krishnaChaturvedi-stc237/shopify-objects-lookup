import * as vscode from 'vscode';
const shopifyData = require('./shopify-data.json');
const contextMap = require('./context-map.json');

export function activate(context: vscode.ExtensionContext) {
	const provider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: 'liquid' },
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				const linePrefix = document.lineAt(position).text.substr(0, position.character + 1);
				const filePath = document.uri.fsPath;

				// 1. Determine File Metadata
				const currentFileName = filePath.split(/[\\/]/).pop()?.replace('.liquid', '') || '';
				const fileType = getFileType(filePath); // 'sections' | 'snippets' | 'templates' | 'unknown'

				// --- TRIGGER 1: "objects:" (The Categorized List) ---
				if (linePrefix.endsWith('objs:')) {
					console.log("currentFileName, fileType:", currentFileName, " -", fileType)
					// Call your Discovery Engine with the fileType
					const verifiedTemplates = await getVerifiedTemplates(currentFileName, fileType as any);
					console.log('verified Templates:', verifiedTemplates)

					// Convert templates to objects (using Set to avoid duplicates)
					const verifiedObjectsSet = new Set<string>();
					verifiedTemplates.forEach(tName => {
						const objs = (contextMap.template_map as any)[tName] || [];
						objs.forEach((o: string) => verifiedObjectsSet.add(o));
					});

					const items: vscode.CompletionItem[] = [];

					// A. ADD GLOBALS (Priority 0)
					contextMap.globals.forEach((obj: string) => {
						const item = new vscode.CompletionItem(`Global > ${obj}`, vscode.CompletionItemKind.Module);
						item.detail = "🌍 Global Shopify Object";
						item.sortText = "0_" + obj;
						items.push(item);
					});

					// B. ADD VERIFIED (Priority 1)
					// Format: templates/product.json > product
					verifiedTemplates.forEach(tName => {
						const objs = (contextMap.template_map as any)[tName] || [];
						objs.forEach((obj: string) => {
							const itemLabel = `templates/${tName}.json > ${obj}`;
							const item = new vscode.CompletionItem(itemLabel, vscode.CompletionItemKind.Interface);

							item.detail = `✅ File is consumed by ${tName}.json`;
							item.documentation = new vscode.MarkdownString(
								`This section/snippet is currently used in **${tName}.json**. ` +
								`The object \`${obj}\` is safe to use.`
							);
							item.sortText = "1_" + tName + obj;
							items.push(item);
						});
					});

					// C. ADD POTENTIAL (Priority 2)
					// Format: product template > product
					Object.keys(contextMap.template_map).forEach(tName => {
						// Only show if the section is NOT already verified in this template
						if (!verifiedTemplates.includes(tName)) {
							const objs = (contextMap.template_map as any)[tName];
							objs.forEach((obj: string) => {
								const itemLabel = `${tName} template > ${obj}`;
								const item = new vscode.CompletionItem(itemLabel, vscode.CompletionItemKind.Reference);

								item.detail = `⚠️ Error Prevention: Not yet used in ${tName}.json`;

								// Educational Warning
								const docs = new vscode.MarkdownString();
								docs.appendMarkdown(`### ⚠️ Context Warning\n`);
								docs.appendMarkdown(`To use the \`${obj}\` object without errors, you **must** add this section/snippet to the **${tName}** template via the Shopify Customizer or by updating \`templates/${tName}.json\`.`);
								item.documentation = docs;

								item.sortText = "2_" + tName + obj;
								items.push(item);
							});
						}
					});

					return items;
				}

				// --- TRIGGER 2: "objectName:" (The Data Reference Paste) ---
				const match = linePrefix.match(/(\w+):$/);
				if (match) {
					const objectName = match[1];
					const data = (shopifyData as any)[objectName];

					if (data) {
						const item = new vscode.CompletionItem(`${objectName} Reference Structure`, vscode.CompletionItemKind.Snippet);

						// Generate Mock JSON from shopify-data properties
						const mockPreview: any = {};
						Object.keys(data.properties).forEach(propKey => {
							mockPreview[propKey] = data.properties[propKey].mock_value ?? "...";
						});

						const docs = new vscode.MarkdownString();
						docs.appendMarkdown(`### 📦 ${objectName} Object Reference\n`);
						docs.appendCodeblock(JSON.stringify(mockPreview, null, 2), 'json');
						docs.appendMarkdown(`\n[Official Documentation](${data.link})`);

						item.documentation = docs;
						item.detail = "Paste full schema as comment";

						// Use your Paste-to-Comment feature
						item.insertText = new vscode.SnippetString(
							`\n{% comment %}\n  ${objectName.toUpperCase()} REFERENCE:\n  ${JSON.stringify(mockPreview, null, 2)}\n{% endcomment %}`
						);

						return [item];
					}
				}

				return undefined;
			}
		},
		':' // Only trigger on colon to keep it "Quiet" until needed
	);

	context.subscriptions.push(provider);
}

/**
 * Helper to identify if we are in a section, snippet, or template directory
 */
function getFileType(path: string): 'sections' | 'snippets' | 'templates' | 'unknown' {
	const normalizedPath = path.replace(/\\/g, '/');
	if (normalizedPath.includes('/sections/')) return 'sections';
	if (normalizedPath.includes('/snippets/')) return 'snippets';
	if (normalizedPath.includes('/templates/')) return 'templates';
	return 'unknown';
}

async function getVerifiedTemplates(fileName: string, fileType: 'sections' | 'snippets' | 'templates'): Promise<string[]> {
	let verified: string[] = [];

    // --- NEW: SPECIAL API CONTEXTS ---
    // If the file is named predictive-search, it's virtually guaranteed 
    // to be used for the predictive search API context.
    if (fileName === 'predictive-search' || fileName === 'predictive_search') {
        verified.push('predictive_search'); 
    }

	if (fileType === 'templates') {
		// If we are in product.liquid, the context is obviously 'product'
		verified.push(fileName.split('.')[0]);
		return verified;
	}

	if (fileType === 'sections') {
		// Sections logic (What you already have)
		return await searchInJsonTemplates(fileName);
	}

	if (fileType === 'snippets') {
		// 1. Find all sections/templates that render this snippet
		const parents = await findSnippetParents(fileName);
		console.log("snippet parents:", parents)
		// 2. For each parent, find its context
		for (const parent of parents) {
			if (parent.type === 'section') {
				const sectionContexts = await searchInJsonTemplates(parent.name);
				verified.push(...sectionContexts);
			} else if (parent.type === 'template') {
				// Split by dot to handle 'page.wholesale' -> 'page'
			    const baseType = parent.name.split('.')[0];
				verified.push(baseType);
			}
		}
	}

	return [...new Set(verified)]; // Remove duplicates
}

/**
 * Specifically for Snippets: Finds which files use {% render 'my-snippet' %}
 */
async function findSnippetParents(snippetName: string): Promise<{ name: string, type: 'section' | 'template' }[]> {
	const parents: { name: string, type: 'section' | 'template' }[] = [];
	console.log("Finding parents for snippet:", snippetName)
	// Search in sections and templates for the render tag
	const files = await vscode.workspace.findFiles('/{sections,templates}/*.liquid');
	console.log('Files to scan for snippet parents:', files)
	for (const file of files) {
		// const doc = await vscode.workspace.openTextDocument(file);
		const fileUint8 = await vscode.workspace.fs.readFile(file);
        const rawContent = Buffer.from(fileUint8).toString('utf8');
		let content = rawContent;

		// 1. STRIP LIQUID COMMENTS (Multi-line and Inline)
		// This ensures we don't suggest objects for a snippet that is commented out!
		content = content
			.replace(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/g, '') // {% comment %}
			.replace(/\{%\s*#[\s\S]*?%\}/g, ''); // {% # inline comment %}

		// 2. Updated Regex to handle 'render' and 'include' with single or double quotes
		// We look for the tag and ensure it's not preceded by a [^a-zA-Z0-9] to be safe
		const renderRegex = new RegExp(`\\{%\\s+(render|include)\\s+['"]${snippetName}['"]`, 'g');

		if (renderRegex.test(content)) {
			console.log(`Found usage in: ${file.fsPath}`);
			// 1. Normalize the path to use forward slashes for the check
			const normalizedPath = file.fsPath.replace(/\\/g, '/');
			// 2. Extract name
			const name = file.fsPath.split(/[\\/]/).pop()?.replace('.liquid', '') || '';
			// 3. Check using the normalized path
			const type = normalizedPath.includes('/sections/') ? 'section' : 'template';
			console.log(`Detected Type for ${name}: ${type}`); // Log this to verify
			parents.push({ name, type });
		}
	}
	return parents;
}

/**
 * Re-usable logic to scan JSON templates for a section type
 */
async function searchInJsonTemplates(sectionName: string): Promise<string[]> {
	console.log("sectionName in searchInJsonTemplates:", sectionName)
	const contexts: string[] = [];
	const files = await vscode.workspace.findFiles('/templates/**/*.json');
	console.log('template files:', files)

	for (const file of files) {
		try {
			const fileUint8 = await vscode.workspace.fs.readFile(file);
            const rawContent = Buffer.from(fileUint8).toString('utf8');

			// 1. STRIP COMMENTS: This regex removes multi-line /* */ and single-line // comments
			const cleanContent = rawContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');

			// 2. PARSE the cleaned string
			const content = JSON.parse(cleanContent);
			const fileName = file.fsPath.split(/[\\/]/).pop() || '';
			const tName = fileName.replace('.json', '');

			if (content.sections && typeof content.sections === 'object') {
				const isUsed = Object.values(content.sections).some((s: any) => {
					// Handle cases where type might be missing or differently formatted
					return s.type?.toLowerCase() === sectionName.toLowerCase();
				});

				if (isUsed) {
					const normalizedPath = file.fsPath.replace(/\\/g, '/');
					// EDGE CASE: If the path contains 'templates/metaobject/', 
                    // the context object is ALWAYS 'metaobject'
                    if (normalizedPath.includes('/templates/metaobject/')) {
                        contexts.push('metaobject');
                    } else {
                        // Regular templates (product, collection, index)
                        const fileName = file.fsPath.split(/[\\/]/).pop() || '';
                        contexts.push(fileName.split('.')[0]);
                    }
				}
			}
		} catch (e) {
			// Log the error so you know if a specific file is failing
			console.error(`Error parsing ${file.fsPath}:`, e);
		}
	}
	return contexts;
}

export function deactivate() { }