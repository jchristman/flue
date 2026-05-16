import { Type } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Harness } from '../src/harness.ts';
import { InMemorySessionStore } from '../src/session.ts';
import {
	runAfterToolHooks,
	runBeforeToolHooks,
	wrapAgentToolsWithHooks,
} from '../src/tool-hooks.ts';
import type { AgentConfig, AgentHooks, SessionEnv } from '../src/types.ts';

function minimalAgentConfig(): AgentConfig {
	return {
		systemPrompt: '',
		skills: {},
		roles: {},
		model: undefined,
		resolveModel: () => undefined,
	};
}

function mockSessionEnv(): SessionEnv {
	const notImpl = async () => {
		throw new Error('not implemented');
	};
	return {
		exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
		readFile: notImpl,
		readFileBuffer: async () => new Uint8Array(),
		writeFile: notImpl,
		stat: notImpl,
		readdir: notImpl,
		exists: async () => false,
		mkdir: notImpl,
		rm: notImpl,
		cwd: '/',
		resolvePath: (p: string) => (p.startsWith('/') ? p : `/${p}`),
	};
}

describe('wrapAgentToolsWithHooks', () => {
	it('runs before hook and blocks execution when before throws', async () => {
		const exec = vi.fn(async () => ({
			content: [{ type: 'text' as const, text: 'ran' }],
			details: {},
		}));
		const tool: AgentTool<any> = {
			name: 'bash',
			label: 'bash',
			description: 'test',
			parameters: Type.Object({ command: Type.String() }),
			execute: exec,
		};
		const wrapped = wrapAgentToolsWithHooks([tool], {
			tool: {
				before: async (call) => {
					if (call.args.command === 'rm -rf /') throw new Error('blocked');
				},
			},
		});

		await expect(wrapped[0]!.execute('tc1', { command: 'rm -rf /' }, undefined)).rejects.toThrow(
			'blocked',
		);
		expect(exec).not.toHaveBeenCalled();

		await wrapped[0]!.execute('tc2', { command: 'echo hi' }, undefined);
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it('invokes after with isError false on success', async () => {
		const after = vi.fn();
		const tool: AgentTool<any> = {
			name: 'read',
			label: 'read',
			description: 'test',
			parameters: Type.Object({ path: Type.String() }),
			async execute() {
				return { content: [{ type: 'text' as const, text: 'ok' }], details: { path: '/' } };
			},
		};
		const wrapped = wrapAgentToolsWithHooks([tool], {
			tool: { after },
		});
		await wrapped[0]!.execute('id', { path: '/x' }, undefined);
		expect(after).toHaveBeenCalledTimes(1);
		const [, outcome] = after.mock.calls[0]!;
		expect(outcome.isError).toBe(false);
		expect(outcome.result?.content[0]).toEqual({ type: 'text', text: 'ok' });
	});

	it('invokes after with isError true when execute throws', async () => {
		const after = vi.fn();
		const tool: AgentTool<any> = {
			name: 'bash',
			label: 'bash',
			description: 'test',
			parameters: Type.Object({ command: Type.String() }),
			async execute() {
				throw new Error('exec failed');
			},
		};
		const wrapped = wrapAgentToolsWithHooks([tool], { tool: { after } });
		await expect(wrapped[0]!.execute('id', { command: 'x' }, undefined)).rejects.toThrow('exec failed');
		expect(after).toHaveBeenCalledTimes(1);
		expect(after.mock.calls[0]![1].isError).toBe(true);
		expect(after.mock.calls[0]![1].error).toMatchObject({ message: 'exec failed' });
	});

	it('logs and preserves outcome when after hook throws', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const tool: AgentTool<any> = {
			name: 'bash',
			label: 'bash',
			description: 'test',
			parameters: Type.Object({ command: Type.String() }),
			async execute() {
				return { content: [{ type: 'text' as const, text: 'done' }], details: {} };
			},
		};
		const wrapped = wrapAgentToolsWithHooks([tool], {
			tool: {
				after: async () => {
					throw new Error('after oops');
				},
			},
		});
		const result = await wrapped[0]!.execute('id', { command: 'x' }, undefined);
		expect(result.content[0]).toEqual({ type: 'text', text: 'done' });
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});
});

describe('runBeforeToolHooks / runAfterToolHooks', () => {
	it('no-ops when hooks are undefined', async () => {
		const call = { toolName: 'x', toolCallId: '1', args: {} };
		await expect(runBeforeToolHooks(call, undefined)).resolves.toBeUndefined();
		await expect(runAfterToolHooks(call, { isError: false }, undefined)).resolves.toBeUndefined();
	});
});

describe('Harness hooks on task child sessions', () => {
	it('passes the same AgentHooks instance to task Session', async () => {
		const hooks: AgentHooks = { tool: { before: async () => {} } };
		const harness = new Harness(
			'inst-1',
			'default',
			minimalAgentConfig(),
			mockSessionEnv(),
			new InMemorySessionStore(),
			undefined,
			[],
			undefined,
			hooks,
		);

		const parent = await harness.session();
		const child = await (harness as any).createTaskSession({
			parentSession: parent.name,
			taskId: 't1',
			parentEnv: mockSessionEnv(),
			depth: 1,
		});

		expect((child as unknown as { hooks?: AgentHooks }).hooks).toBe(hooks);
	});
});
