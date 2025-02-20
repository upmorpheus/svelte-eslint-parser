<script>
	import { onDestroy, onMount } from 'svelte';
	import { Linter } from 'eslint';
	import * as svelteEslintParser from 'svelte-eslint-parser';
	import ESLintEditor from './ESLintEditor.svelte';
	import RulesSettings from './RulesSettings.svelte';
	import { deserializeState, serializeState } from './scripts/state';
	import { DEFAULT_RULES_CONFIG, getURL } from './scripts/rules.js';

	const linter = new Linter();
	linter.defineParser('svelte-eslint-parser', svelteEslintParser);

	const DEFAULT_CODE =
		`<script>
    let a = 1;
    let b = 2;
    // let c = 2;
<` +
		`/script>

<input type="number" bind:value={a}>
<input type="number" bind:value={b}>
<input type="number" bind:value={c}>

<p>{a} + {b} + {c} = {a + b + c}</p>`;

	const state = deserializeState(
		(typeof window !== 'undefined' && window.location.hash.slice(1)) || ''
	);
	let code = state.code || DEFAULT_CODE;
	let rules = state.rules || Object.assign({}, DEFAULT_RULES_CONFIG);
	let messages = [];
	let useEslintPluginSvelte3 = Boolean(state.useEslintPluginSvelte3);
	let time = '';
	let options = {};

	$: hasLangTs = /lang\s*=\s*(?:"ts"|ts|'ts'|"typescript"|typescript|'typescript')/u.test(code);
	let tsParser = undefined;
	$: {
		if (hasLangTs && !tsParser) {
			import('@typescript-eslint/parser').then((parser) => {
				if (typeof window !== 'undefined') {
					if (!window.process) {
						window.process = {
							cwd: () => '',
							env: {}
						};
					}
				}
				tsParser = parser;
			});
		}
	}
	$: {
		options = useEslintPluginSvelte3 ? getEslintPluginSvelte3Options() : {};
	}
	async function getEslintPluginSvelte3Options() {
		const pluginSvelte3 = await import('eslint-plugin-svelte3');
		return {
			preprocess: pluginSvelte3.processors.svelte3.preprocess,
			postprocess: pluginSvelte3.processors.svelte3.postprocess
		};
	}

	// eslint-disable-next-line no-use-before-define -- false positive
	$: serializedString = (() => {
		const serializeCode = DEFAULT_CODE === code ? undefined : code;
		const serializeRules = equalsRules(DEFAULT_RULES_CONFIG, rules) ? undefined : rules;
		return serializeState({
			code: serializeCode,
			rules: serializeRules,
			useEslintPluginSvelte3: useEslintPluginSvelte3 ? true : undefined
		});
	})();
	$: {
		if (typeof window !== 'undefined') {
			window.location.replace(`#${serializedString}`);
		}
	}
	onMount(() => {
		if (typeof window !== 'undefined') {
			window.addEventListener('hashchange', onUrlHashChange);
		}
	});
	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('hashchange', onUrlHashChange);
		}
	});
	function onLintedResult(evt) {
		messages = evt.detail.messages;
		time = `${evt.detail.time}ms`;
	}
	function onUrlHashChange() {
		const newSerializedString =
			(typeof window !== 'undefined' && window.location.hash.slice(1)) || '';
		if (newSerializedString !== serializedString) {
			const state = deserializeState(newSerializedString);
			code = state.code || DEFAULT_CODE;
			rules = state.rules || Object.assign({}, DEFAULT_RULES_CONFIG);
			useEslintPluginSvelte3 = Boolean(state.useEslintPluginSvelte3);
		}
	}

	/** */
	function equalsRules(a, b) {
		const akeys = Object.keys(a).filter((k) => a[k] !== 'off');
		const bkeys = Object.keys(b).filter((k) => b[k] !== 'off');
		if (akeys.length !== bkeys.length) {
			return false;
		}

		for (const k of akeys) {
			if (a[k] !== b[k]) {
				return false;
			}
		}
		return true;
	}
</script>

<div class="playground-root">
	<div class="playground-tools">
		<label>
			<input bind:checked={useEslintPluginSvelte3} type="checkbox" />
			See result of
			<a href="https://github.com/sveltejs/eslint-plugin-svelte3">eslint-plugin-svelte3</a>.
		</label>
		{#if useEslintPluginSvelte3}
			<span style="color: red">svelte-eslint-parser is not used.</span>
		{/if}
		<span style="margin-left: 16px">{time}</span>
	</div>
	<div class="playground-content">
		<RulesSettings bind:rules class="rules-settings" />
		<div class="editor-content">
			<ESLintEditor
				{linter}
				bind:code
				config={{
					parser: useEslintPluginSvelte3 ? undefined : 'svelte-eslint-parser',
					parserOptions: {
						ecmaVersion: 2020,
						sourceType: 'module',
						parser: { ts: tsParser, typescript: tsParser }
					},
					rules,
					env: {
						browser: true,
						es2021: true
					}
				}}
				{options}
				class="eslint-playground"
				on:result={onLintedResult}
			/>
			<div class="messages">
				<ol>
					{#each messages as msg, i (`${msg.line}:${msg.column}:${msg.ruleId}@${i}`)}
						<li class="message">
							[{msg.line}:{msg.column}]:
							{msg.message} (<a href={getURL(msg.ruleId)} target="_blank" rel="noopener noreferrer">
								{msg.ruleId}
							</a>)
						</li>
					{/each}
				</ol>
			</div>
		</div>
	</div>
</div>

<style>
	.playground-root {
		height: 100%;
	}
	.playground-tools {
		height: 24px;
	}
	.playground-content {
		display: flex;
		flex-wrap: wrap;
		height: calc(100% - 16px);
		border: 1px solid #cfd4db;
		background-color: #282c34;
		color: #f8c555;
	}

	.playground-content > .editor-content {
		height: 100%;
		flex: 1;
		display: flex;
		flex-direction: column;
		border-left: 1px solid #cfd4db;
		min-width: 1px;
	}

	.playground-content > .editor-content > .messages {
		height: 30%;
		width: 100%;
		overflow: auto;
		box-sizing: border-box;
		border-top: 1px solid #cfd4db;
		padding: 8px;
		font-size: 12px;
	}
</style>
