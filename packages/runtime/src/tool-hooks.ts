import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentHooks, ToolHookCall, ToolHookResult } from './types.ts';

function hookArgsFromParams(params: unknown): Record<string, unknown> {
	if (params && typeof params === 'object' && !Array.isArray(params)) {
		return params as Record<string, unknown>;
	}
	return { value: params as unknown };
}

/** Run `hooks.tool.before` when present. */
export async function runBeforeToolHooks(
	call: ToolHookCall,
	hooks: AgentHooks | undefined,
): Promise<void> {
	const before = hooks?.tool?.before;
	if (!before) return;
	await before(call);
}

/**
 * Run `hooks.tool.after` when present. Errors are logged and swallowed so audit hooks
 * cannot change model-visible outcomes.
 */
export async function runAfterToolHooks(
	call: ToolHookCall,
	outcome: ToolHookResult,
	hooks: AgentHooks | undefined,
): Promise<void> {
	const after = hooks?.tool?.after;
	if (!after) return;
	try {
		await after(call, outcome);
	} catch (error) {
		console.error('[flue:hooks] tool.after hook threw:', error);
	}
}

/**
 * Wrap each pi-agent tool's execute with harness before/after hooks.
 */
export function wrapAgentToolsWithHooks(
	tools: AgentTool<any>[],
	hooks: AgentHooks | undefined,
): AgentTool<any>[] {
	if (!hooks?.tool?.before && !hooks?.tool?.after) return tools;

	return tools.map((tool) => {
		const originalExecute = tool.execute.bind(tool);
		return {
			...tool,
			async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
				const call: ToolHookCall = {
					toolName: tool.name,
					toolCallId,
					args: hookArgsFromParams(params),
				};
				await runBeforeToolHooks(call, hooks);
				try {
					const result = await originalExecute(toolCallId, params, signal);
					await runAfterToolHooks(call, { isError: false, result }, hooks);
					return result;
				} catch (error) {
					await runAfterToolHooks(call, { isError: true, error }, hooks);
					throw error;
				}
			},
		} as AgentTool<any>;
	});
}
