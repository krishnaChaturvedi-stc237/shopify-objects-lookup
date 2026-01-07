import * as vscode from 'vscode';
import { performance } from 'perf_hooks';
const shopifyData = require('./shopify-data.json');
const contextMap = require('./context-map.json');

interface TemplateContext {
	contextKey: string;     // e.g., 'collection' (used to find objects in context-map)
	displayName: string;    // e.g., 'collection.wholesale' (shown to the user)
}

const outputChannel = vscode.window.createOutputChannel("Shopify Object Lookup");

function log(message: string, data?: any, performanceCheck: boolean = false) {
	const timestamp = new Date().toLocaleTimeString();
	if (performanceCheck && data && typeof data === 'number') {
		const durationLog = data ? ` [Took ${data.toFixed(2)}ms]` : '';
		outputChannel.appendLine(`[${timestamp}] ${message}${durationLog}`);
	} else if (data) {
		// If data is an object, stringify it so it's readable
		const dataString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
		outputChannel.appendLine(`[${timestamp}] ${message}: ${dataString}`);
	} else {
		outputChannel.appendLine(`[${timestamp}] ${message}`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	log("==== Shopify Object Lookup is now active! ====");
	const provider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: 'liquid' },
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				const linePrefix = document.lineAt(position).text.substr(0, position.character + 1);
				const filePath = document.uri.fsPath;

				// 1. Determine File Metadata
				const currentFileName = filePath.split(/[\\/]/).pop()?.replace('.liquid', '') || '';
				const normalizedPath = filePath.replace(/\\/g, '/');
				const fileType = getFileType(filePath); // 'sections' | 'snippets' | 'templates' | 'unknown'

				// --- TRIGGER 1: "objects:" (The Categorized List) ---
				if (linePrefix.endsWith('objs:')) {
					const startTime = performance.now();
					log("currentFileName", currentFileName);
					log("fileType", fileType);
					const items: vscode.CompletionItem[] = [];

					// --- BRANCH 1: ASSETS (The most restricted) ---
					if (fileType === 'assets') {
						const item = new vscode.CompletionItem(`Global > settings`, vscode.CompletionItemKind.Module);
						item.detail = "ONLY object available in assets";
						item.documentation = "Assets only have access to theme settings and filters.";
						items.push(item);
						log(`Assets scope applied for ${currentFileName}`, performance.now() - startTime, true);
						return items;
					}

					// --- BRANCH 2: LAYOUTS (Global Shell) ---
					if (fileType === 'layout') {
						contextMap.globals.forEach((obj: string) => {
							const item = new vscode.CompletionItem(`Global > ${obj}`, vscode.CompletionItemKind.Module);
							item.sortText = "0_" + obj;
							items.push(item);
						});
						const sectionItem = new vscode.CompletionItem(`Structural > section`, vscode.CompletionItemKind.Struct);
						sectionItem.detail = "Access static section settings";
						items.push(sectionItem);
						log(`Layout scope applied for ${currentFileName}`, performance.now() - startTime, true);
						return items;
					}

					// --- BRANCH 3: TEMPLATES (Specific Root) ---
					if (fileType === 'templates') {
						// 1. Add Globals
						contextMap.globals.forEach((obj: string) => {
							const item = new vscode.CompletionItem(`Global > ${obj}`, vscode.CompletionItemKind.Module);
							item.sortText = "0_" + obj;
							items.push(item);
						});
						// 2. Add the specific root object (product.liquid gets product)
						const rootObj = currentFileName.split('.')[0];
						const item = new vscode.CompletionItem(`Verified > ${rootObj}`, vscode.CompletionItemKind.Interface);
						item.detail = `Primary object for ${currentFileName}`;
						item.sortText = "0_0_" + rootObj;
						items.push(item);

						log(`Template scope applied for ${currentFileName}`, performance.now() - startTime, true);
						return items;
					}

					// --- 2. ADD STRUCTURAL (Scoped Logic) ---

					// Logic for SECTIONS
					if (fileType === 'sections') {
						addStructuralItems(['section', 'closest'], items, "0");
					}

					// Logic for BLOCKS
					if (fileType === 'blocks') {
						addStructuralItems(['block', 'section', 'closest'], items, "0");
					}

					// Logic for SNIPPETS
					if (fileType === 'snippets') {
						addStructuralItems(['section', 'block', 'closest'], items, "0", "Inherited from parent");
					}

					// Call your Discovery Engine with the fileType
					const verifiedTemplates = await getVerifiedTemplates(currentFileName, fileType as any);
					log('verified Templates:', verifiedTemplates)

					// Convert templates to objects (using Set to avoid duplicates)
					const verifiedObjectsSet = new Set<string>();
					verifiedTemplates.forEach(tObj => {
						const objs = (contextMap.template_map as any)[tObj.contextKey] || [];
						objs.forEach((o: string) => verifiedObjectsSet.add(o));
					});


					// A. ADD GLOBALS (Priority 0)
					contextMap.globals.forEach((obj: string) => {
						const item = new vscode.CompletionItem(`Global > ${obj}`, vscode.CompletionItemKind.Module);
						item.detail = "🌍 Global Shopify Object";
						item.sortText = "1_" + obj;
						items.push(item);
					});

					// B. ADD VERIFIED (Priority 1)
					// Format: templates/product.json > product
					verifiedTemplates.forEach(tObj => {
						const specificObjs = (contextMap.template_map as any)[tObj.contextKey] || [];
						specificObjs.forEach((obj: string) => {
							const itemLabel = `templates/${tObj.displayName}.json > ${obj}`;
							const item = new vscode.CompletionItem(itemLabel, vscode.CompletionItemKind.Interface);

							item.detail = `✅ File is consumed by ${tObj.displayName}.json`;
							item.documentation = new vscode.MarkdownString(
								`This section/snippet is currently used in **${tObj.displayName}.json**. ` +
								`The object \`${obj}\` is safe to use.`
							);
							item.sortText = "2_" + tObj.displayName + obj;
							items.push(item);
						});
					});

					// C. ADD POTENTIAL (Priority 2)
					// Format: product template > product
					Object.keys(contextMap.template_map).forEach(tName => {
						// Only show if the section is NOT already verified in this template
						const isAlreadyVerified = verifiedTemplates.some(vt => vt.contextKey === tName);
						if (!isAlreadyVerified) {
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

								item.sortText = "3_" + tName + obj;
								items.push(item);
							});
						}
					});

					const endTime = performance.now();
					const totalTime = endTime - startTime;

					log(`----Discovery completed---- Found ${verifiedTemplates.length} templates.`, totalTime, true);
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
function getFileType(path: string): 'sections' | 'snippets' | 'templates' | 'layout' | 'assets' | 'blocks' | 'unknown' {
	const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
	if (normalizedPath.includes('/sections/') || normalizedPath.endsWith('/sections')) return 'sections';
	if (normalizedPath.includes('/snippets/') || normalizedPath.endsWith('/snippets')) return 'snippets';
	if (normalizedPath.includes('/templates/') || normalizedPath.endsWith('/templates')) return 'templates';
	if (normalizedPath.includes('/layout/') || normalizedPath.endsWith('/layout')) return 'layout';
	if (normalizedPath.includes('/assets/') || normalizedPath.endsWith('/assets')) return 'assets';
	if (normalizedPath.includes('/blocks/') || normalizedPath.endsWith('/blocks')) return 'blocks';
	return 'unknown';
}

function addStructuralItems(objs: string[], items: vscode.CompletionItem[], priority: string, detailAddon: string = "") {
	objs.forEach((sObj, i) => {
		const item = new vscode.CompletionItem(`Structural > ${sObj}`, vscode.CompletionItemKind.Struct);
		if (detailAddon) item.detail = detailAddon;
		item.sortText = `${priority}_${i}_${sObj}`;
		items.push(item);
	});
}

async function getVerifiedTemplates(fileName: string, fileType: 'sections' | 'snippets' | 'templates'): Promise<TemplateContext[]> {
	let verified: TemplateContext[] = [];

	// --- 1. SPECIAL API CONTEXTS ---
	if (fileName === 'predictive-search' || fileName === 'predictive_search') {
		verified.push({
			contextKey: 'predictive_search',
			displayName: 'predictive-search'
		});
	}

	// --- 2. TEMPLATE FILE CONTEXT ---
	if (fileType === 'templates') {
		verified.push({
			contextKey: fileName.split('.')[0],
			displayName: fileName
		});
		return verified;
	}

	// --- 3. SECTION FILE CONTEXT ---
	if (fileType === 'sections') {
		return await searchInJsonTemplates(fileName);
	}

	// --- 4. SNIPPET FILE CONTEXT ---
	if (fileType === 'snippets') {
		const parents = await findSnippetParents(fileName);
		log("snippet parents found:", parents);

		for (const parent of parents) {
			if (parent.type === 'section') {
				const sectionContexts = await searchInJsonTemplates(parent.name);
				verified.push(...sectionContexts);
			} else if (parent.type === 'template' || parent.type === 'layout') {
				verified.push({
					contextKey: parent.name.split('.')[0],
					displayName: parent.name
				});
			}
		}
	}

	// --- 5. UNIQUE FILTER (Deduplicate by displayName) ---
	const uniqueResults = verified.filter((v, i, a) =>
		a.findIndex(t => t.displayName === v.displayName) === i
	);

	return uniqueResults;
}
/**
 * Specifically for Snippets: Finds which files use {% render 'my-snippet' %}
 */
async function findSnippetParents(snippetName: string): Promise<{ name: string, type: 'section' | 'template' | 'layout' }[]> {
	const parents: { name: string, type: 'section' | 'template' | 'layout' }[] = [];

	// 1. ADD 'layout' to the glob pattern
	const files = await vscode.workspace.findFiles('**/{sections,templates,layout}/*.liquid');
	const cleanSnippetName = snippetName.replace('.liquid', '').trim();
	for (const file of files) {
		try {
			const fileUint8 = await vscode.workspace.fs.readFile(file);
			const rawContent = Buffer.from(fileUint8).toString('utf8');

			// 2. STRIP COMMENTS (Added 'i' flag for Case-Insensitivity like {% Comment %})
			let content = rawContent
				.replace(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/gi, '')
				.replace(/\{%\s*#[\s\S]*?%\}/g, '');

			// 3. IMPROVED REGEX
			// Handles 'render', 'include', and extra spaces/parameters
			const renderRegex = new RegExp(`\\{%-?\\s*(render|include)\\s+['"]${cleanSnippetName}['"]`, 'gi');
			if (renderRegex.test(content)) {
				const normalizedPath = file.fsPath.replace(/\\/g, '/');
				const fileName = file.fsPath.split(/[\\/]/).pop() || '';
				const name = fileName.replace('.liquid', '');

				// 4. DETERMINE TYPE
				let type: 'section' | 'template' | 'layout' = 'template';
				if (normalizedPath.includes('/sections/')) type = 'section';
				else if (normalizedPath.includes('/layout/')) type = 'layout';

				parents.push({ name, type });
			}
		} catch (e) {
			console.error(`Error reading ${file.fsPath}:`, e);
		}
	}
	return parents;
}
/**
 * Re-usable logic to scan JSON templates for a section type
 */

async function searchInJsonTemplates(sectionName: string): Promise<TemplateContext[]> {
	const results: TemplateContext[] = [];
	const files = await vscode.workspace.findFiles('**/templates/**/*.json');
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
					return s.type?.toLowerCase() === sectionName.toLowerCase();
				});

				if (isUsed) {
					const normalizedPath = file.fsPath.replace(/\\/g, '/');

					if (normalizedPath.includes('/templates/metaobject/')) {
						results.push({
							contextKey: 'metaobject',
							displayName: `metaobject/${tName}`
						});
					} else {
						results.push({
							contextKey: tName.split('.')[0], // "collection.wholesale" -> "collection"
							displayName: tName
						});
					}
				}
			}
		} catch (e) {
			// Log the error so you know if a specific file is failing
			console.error(`Error parsing ${file.fsPath}:`, e);
		}
	}
	return results;
}

export function deactivate() { }