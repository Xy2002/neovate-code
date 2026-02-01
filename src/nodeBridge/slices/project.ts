import z from 'zod';
import { ConfigManager } from '../../config';
import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { resolveModelWithContext } from '../../provider/model';
import { sanitizeAIResponse } from '../../utils/sanitizeAIResponse';
import { getCurrentBranch } from '../../worktree';

type WorkspaceData = {
  id: string;
  repoPath: string;
  branch: string;
  worktreePath: string;
  sessionIds: string[];
  gitState: {
    currentCommit: string;
    isDirty: boolean;
    pendingChanges: string[];
  };
  metadata: {
    createdAt: number;
    description: string;
    status: 'active' | 'archived' | 'stale';
  };
  context: {
    activeFiles: string[];
    settings: any;
    preferences: Record<string, unknown>;
  };
};

async function buildWorkspaceData(
  worktree: {
    id: string;
    name: string;
    path: string;
    branch: string;
    isClean: boolean;
  },
  context: Context,
  gitRoot: string,
): Promise<WorkspaceData> {
  const { getCurrentCommit, getPendingChanges } = await import(
    '../../utils/git'
  );
  const { Paths } = await import('../../paths');
  const { statSync } = await import('fs');

  let currentCommit = '';
  let pendingChanges: string[] = [];
  try {
    currentCommit = await getCurrentCommit(worktree.path);
  } catch {
    // Use empty string as default
  }

  const isDirty = !worktree.isClean;

  try {
    pendingChanges = await getPendingChanges(worktree.path);
  } catch {
    // Use empty array as default
  }

  const worktreePaths = new Paths({
    productName: context.productName,
    cwd: worktree.path,
  });
  const sessions = worktreePaths.getAllSessions();
  const sessionIds = sessions.map((s) => s.sessionId);

  let createdAt = Date.now();
  try {
    const stats = statSync(worktree.path);
    createdAt = stats.birthtimeMs || stats.ctimeMs;
  } catch {
    // Use current time as fallback
  }

  let status: 'active' | 'archived' | 'stale' = 'active';
  const daysSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation > 30 && !isDirty && sessionIds.length === 0) {
    status = 'stale';
  }

  const activeFiles: string[] = [];
  const settings = context.config;

  return {
    id: worktree.id,
    repoPath: gitRoot,
    branch: worktree.branch,
    worktreePath: worktree.path,
    sessionIds,
    gitState: {
      currentCommit,
      isDirty,
      pendingChanges,
    },
    metadata: {
      createdAt,
      description: '',
      status,
    },
    context: {
      activeFiles,
      settings,
      preferences: {},
    },
  };
}

function createGenerateCommitSystemPrompt(
  language: string,
  systemPrompt?: string,
) {
  const { isEnglish } = require('../../utils/language');
  const useEnglish = isEnglish(language);
  const descriptionLang = useEnglish
    ? ''
    : `\n   - Use ${language} for the description`;
  const summaryLang = useEnglish ? '' : `\n   - Use ${language}`;
  return `
You are an expert software engineer that generates Git commit information based on provided diffs.

Review the provided context and diffs which are about to be committed to a git repo.
Analyze the changes carefully and generate a JSON response with the following fields:

1. **commitMessage**: A one-line commit message following conventional commit format
   - Format: <type>: <description>
   - Types: fix, feat, build, chore, ci, docs, style, refactor, perf, test${descriptionLang}
   - Use imperative mood (e.g., "add feature" not "added feature")
   - Do not exceed 72 characters
   - Do not capitalize the first letter
   - Do not end with a period

2. **branchName**: A suggested Git branch name
   - Format: <type>/<description> for conventional commits, or <description> for regular changes
   - Use only lowercase letters, numbers, and hyphens
   - Maximum 50 characters
   - No leading or trailing hyphens

3. **isBreakingChange**: Boolean indicating if this is a breaking change
   - Set to true if the changes break backward compatibility
   - Look for removed public APIs, changed function signatures, etc.

4. **summary**: A brief 1-2 sentence summary of the changes${summaryLang}
   - Describe what was changed and why

${systemPrompt ? `\n${systemPrompt}` : ''}

## Response Format

Respond with valid JSON only, no additional text or markdown formatting.

Example response:
{
  "commitMessage": "feat: add user authentication system",
  "branchName": "feat/add-user-authentication",
  "isBreakingChange": false,
  "summary": "Added JWT-based authentication with login and logout endpoints."
}
  `.trim();
}

export function registerProjectHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
  clearContext: (cwd?: string) => Promise<void>,
) {
  messageBus.registerHandler('project.addHistory', async (data) => {
    const { cwd, history } = data;
    const context = await getContext(cwd);
    const { GlobalData } = await import('../../globalData');
    const globalDataPath = context.paths.getGlobalDataPath();
    const globalData = new GlobalData({
      globalDataPath,
    });
    globalData.addProjectHistory({
      cwd,
      history,
    });
    return {
      success: true,
    };
  });

  messageBus.registerHandler('project.clearContext', async (data) => {
    await clearContext(data.cwd);
    return {
      success: true,
    };
  });

  messageBus.registerHandler('project.addMemory', async (data) => {
    const { cwd, global: isGlobal, rule } = data;
    const context = await getContext(cwd);
    const { appendFileSync } = await import('fs');
    const { join } = await import('path');

    const memoryFile = isGlobal
      ? join(context.paths.globalConfigDir, 'AGENTS.md')
      : join(cwd, 'AGENTS.md');

    appendFileSync(memoryFile, `- ${rule}\n`, 'utf-8');

    return {
      success: true,
    };
  });

  messageBus.registerHandler('project.analyzeContext', async (data) => {
    const { cwd, sessionId } = data;
    try {
      const context = await getContext(cwd);
      const { loadSessionMessages } = await import('../../session');
      const { countTokens } = await import('../../utils/tokenCounter');
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('pathe');

      const logPath = context.paths.getSessionLogPath(sessionId);
      const messages = loadSessionMessages({ logPath });

      const lastAssistantMessage = messages
        .slice()
        .reverse()
        .find((msg) => msg.role === 'assistant');

      if (!lastAssistantMessage) {
        return {
          success: false,
          error:
            'No context available - send a message first to analyze context usage',
        };
      }

      const requestId = lastAssistantMessage.uuid;
      const requestsDir = join(context.paths.globalProjectDir, 'requests');
      const requestLogPath = join(requestsDir, `${requestId}.jsonl`);

      if (!existsSync(requestLogPath)) {
        return {
          success: false,
          error: 'Request log file not found',
        };
      }

      const content = readFileSync(requestLogPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length === 0) {
        return {
          success: false,
          error: 'Request log is empty',
        };
      }

      let metadata: any;
      try {
        metadata = JSON.parse(lines[0]);
      } catch {
        return {
          success: false,
          error: 'Failed to parse request log',
        };
      }

      const requestBody = metadata.request?.body;
      if (!requestBody) {
        return {
          success: false,
          error: 'Invalid request log format',
        };
      }

      const { model } = metadata;
      if (!model || !model.model || !model.model.limit) {
        return {
          success: false,
          error: 'Failed to resolve model context window',
        };
      }

      const totalContextWindow = model.model.limit.context;

      const systemPromptTokens = (() => {
        const systemPrompt = requestBody.system || [];
        const messages = requestBody.messages || [];
        for (const message of messages) {
          if (message.role === 'system') {
            systemPrompt.push(message);
          }
        }
        if (!systemPrompt.length) return 0;
        return countTokens(JSON.stringify(systemPrompt));
      })();

      const tools = requestBody.tools || [];
      const systemTools: any[] = [];
      const mcpTools: any[] = [];

      for (const tool of tools) {
        if (tool.name?.startsWith('mcp__')) {
          mcpTools.push(tool);
        } else {
          systemTools.push(tool);
        }
      }

      const systemToolsTokens = systemTools.length
        ? countTokens(JSON.stringify(systemTools))
        : 0;
      const mcpToolsTokens = mcpTools.length
        ? countTokens(JSON.stringify(mcpTools))
        : 0;

      const messagesTokens = (() => {
        const messages = (requestBody.messages || []).filter(
          (item: any) => item.role !== 'system',
        );
        return countTokens(JSON.stringify(messages));
      })();

      const totalUsed =
        systemPromptTokens +
        systemToolsTokens +
        mcpToolsTokens +
        messagesTokens;
      const freeSpaceTokens = Math.max(0, totalContextWindow - totalUsed);

      const calculatePercentage = (tokens: number) =>
        (tokens / totalContextWindow) * 100;

      return {
        success: true,
        data: {
          systemPrompt: {
            tokens: systemPromptTokens,
            percentage: calculatePercentage(systemPromptTokens),
          },
          systemTools: {
            tokens: systemToolsTokens,
            percentage: calculatePercentage(systemToolsTokens),
          },
          mcpTools: {
            tokens: mcpToolsTokens,
            percentage: calculatePercentage(mcpToolsTokens),
          },
          messages: {
            tokens: messagesTokens,
            percentage: calculatePercentage(messagesTokens),
          },
          freeSpace: {
            tokens: freeSpaceTokens,
            percentage: calculatePercentage(freeSpaceTokens),
          },
          totalContextWindow,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to analyze context',
      };
    }
  });

  messageBus.registerHandler('projects.list', async (data) => {
    const { cwd, includeSessionDetails = false } = data;
    try {
      const context = await getContext(cwd);
      const { GlobalData } = await import('../../globalData');
      const { Paths } = await import('../../paths');
      const { existsSync } = await import('fs');

      const globalDataPath = context.paths.getGlobalDataPath();
      const globalData = new GlobalData({ globalDataPath });

      const allData = (globalData as any)['readData']();
      const allProjectPaths = Object.keys(allData.projects || {});

      const existingProjectPaths = allProjectPaths.filter((projectPath) =>
        existsSync(projectPath),
      );

      const projects = existingProjectPaths.map((projectPath) => {
        const projectPaths = new Paths({
          productName: context.productName,
          cwd: projectPath,
        });

        let sessionCount = 0;
        let lastAccessed: number | null = null;
        let sessions: Array<{
          sessionId: string;
          modified: Date;
          created: Date;
          messageCount: number;
          summary: string;
        }> = [];

        if (existsSync(projectPaths.globalProjectDir)) {
          const allSessions = projectPaths.getAllSessions();
          sessionCount = allSessions.length;

          if (allSessions.length > 0) {
            lastAccessed = allSessions[0].modified.getTime();
          }

          if (includeSessionDetails) {
            sessions = allSessions;
          }
        }

        const result: {
          path: string;
          lastAccessed: number | null;
          sessionCount: number;
          sessions?: typeof sessions;
        } = {
          path: projectPath,
          lastAccessed,
          sessionCount,
        };

        if (includeSessionDetails) {
          result.sessions = sessions;
        }

        return result;
      });

      const projectsWithSessions = projects
        .filter((project) => project.sessionCount > 0)
        .sort((a, b) => {
          if (a.lastAccessed === null && b.lastAccessed === null) return 0;
          if (a.lastAccessed === null) return 1;
          if (b.lastAccessed === null) return -1;
          return b.lastAccessed - a.lastAccessed;
        });

      return {
        success: true,
        data: {
          projects: projectsWithSessions,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to list projects',
      };
    }
  });

  messageBus.registerHandler('project.getRepoInfo', async (data) => {
    const { cwd } = data;
    try {
      const { existsSync } = await import('fs');

      if (!existsSync(cwd)) {
        return {
          success: false,
          error: `Directory does not exist: ${cwd}`,
        };
      }

      const timings: Record<string, number> = {};
      const startTotal = Date.now();

      let t0 = Date.now();
      const context = await getContext(cwd);
      timings['getContext'] = Date.now() - t0;

      t0 = Date.now();
      const { getGitRoot, listWorktrees, isGitRepository } = await import(
        '../../worktree'
      );
      const { getGitRemoteUrl, getDefaultBranch } = await import(
        '../../utils/git'
      );
      const { GlobalData } = await import('../../globalData');
      const { basename } = await import('pathe');
      timings['imports'] = Date.now() - t0;

      t0 = Date.now();
      const isGit = await isGitRepository(cwd);
      timings['isGitRepository'] = Date.now() - t0;

      t0 = Date.now();
      const globalDataPath = context.paths.getGlobalDataPath();
      const globalData = new GlobalData({ globalDataPath });

      const configManager = new ConfigManager(cwd, context.productName, {});
      const settings = configManager.projectConfig;

      if (!isGit) {
        const lastAccessed =
          globalData.getProjectLastAccessed({ cwd }) || Date.now();
        globalData.updateProjectLastAccessed({ cwd });
        timings['globalData'] = Date.now() - t0;
        timings['total'] = Date.now() - startTotal;

        const repoData = {
          path: cwd,
          name: basename(cwd),
          workspaceIds: [`${cwd}:default`],
          metadata: {
            lastAccessed,
            settings,
          },
        };

        return {
          success: true,
          data: { repoData, timings },
        };
      }

      t0 = Date.now();
      const gitRoot = await getGitRoot(cwd);
      timings['getGitRoot'] = Date.now() - t0;

      t0 = Date.now();
      const originUrl = await getGitRemoteUrl(gitRoot);
      timings['getGitRemoteUrl'] = Date.now() - t0;

      t0 = Date.now();
      const defaultBranch = await getDefaultBranch(gitRoot);
      timings['getDefaultBranch'] = Date.now() - t0;

      t0 = Date.now();
      const worktrees = await listWorktrees(gitRoot);
      timings['listWorktrees'] = Date.now() - t0;
      const workspaceIds = worktrees.map((w) => w.id);

      t0 = Date.now();
      const lastAccessed =
        globalData.getProjectLastAccessed({ cwd: gitRoot }) || Date.now();
      globalData.updateProjectLastAccessed({ cwd: gitRoot });
      timings['globalData'] = Date.now() - t0;

      timings['total'] = Date.now() - startTotal;

      const repoData = {
        path: gitRoot,
        name: basename(gitRoot),
        workspaceIds,
        metadata: {
          lastAccessed,
          settings,
        },
        gitRemote: {
          originUrl,
          defaultBranch,
        },
      };

      return {
        success: true,
        data: { repoData, timings },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get repository info',
      };
    }
  });

  messageBus.registerHandler('project.workspaces.list', async (data) => {
    const { cwd } = data;
    try {
      const { existsSync, statSync } = await import('fs');

      if (!existsSync(cwd)) {
        return {
          success: false,
          error: `Directory does not exist: ${cwd}`,
        };
      }

      const context = await getContext(cwd);
      const { getGitRoot, listWorktrees, isGitRepository } = await import(
        '../../worktree'
      );

      const isGit = await isGitRepository(cwd);
      if (!isGit) {
        let createdAt = Date.now();
        try {
          const stats = statSync(cwd);
          createdAt = stats.birthtimeMs || stats.ctimeMs;
        } catch {
          // Use current time as fallback
        }

        const defaultWorkspace = {
          id: `${cwd}:default`,
          repoPath: cwd,
          branch: 'default',
          worktreePath: cwd,
          sessionIds: context.paths.getAllSessions().map((s) => s.sessionId),
          gitState: {
            currentCommit: '',
            isDirty: false,
            pendingChanges: [],
          },
          metadata: {
            createdAt,
            description: '',
            status: 'active' as const,
          },
          context: {
            activeFiles: [],
            settings: context.config,
            preferences: {},
          },
        };

        return {
          success: true,
          data: { workspaces: [defaultWorkspace] },
        };
      }

      const gitRoot = await getGitRoot(cwd);
      const worktrees = await listWorktrees(gitRoot);

      const workspacesData = await Promise.all(
        worktrees.map((worktree) =>
          buildWorkspaceData(worktree, context, gitRoot),
        ),
      );

      const rootBranch = await getCurrentBranch(gitRoot);
      const rootWorkspaceData = await buildWorkspaceData(
        {
          id: `${gitRoot}:${rootBranch}`,
          name: rootBranch,
          path: gitRoot,
          branch: rootBranch,
          isClean: true,
        },
        context,
        gitRoot,
      );
      workspacesData.push(rootWorkspaceData);

      return {
        success: true,
        data: { workspaces: workspacesData },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get workspaces info',
      };
    }
  });

  messageBus.registerHandler('project.workspaces.get', async (data) => {
    const { cwd, workspaceId } = data;
    try {
      const context = await getContext(cwd);
      const { getGitRoot, listWorktrees, isGitRepository } = await import(
        '../../worktree'
      );

      const isGit = await isGitRepository(cwd);
      if (!isGit) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const gitRoot = await getGitRoot(cwd);
      const worktrees = await listWorktrees(gitRoot);

      const worktree = worktrees.find((w) => w.name === workspaceId);
      if (!worktree) {
        return {
          success: false,
          error: `Workspace '${workspaceId}' not found`,
        };
      }

      const workspaceData = await buildWorkspaceData(
        worktree,
        context,
        gitRoot,
      );

      return {
        success: true,
        data: workspaceData,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get workspace info',
      };
    }
  });

  messageBus.registerHandler('project.workspaces.create', async (data) => {
    const { cwd, name, skipUpdate = false } = data;
    try {
      const context = await getContext(cwd);
      const {
        getGitRoot,
        isGitRepository,
        detectMainBranch,
        updateMainBranch,
        generateWorkspaceName,
        createWorktree,
        addToGitExclude,
      } = await import('../../worktree');
      const { existsSync, mkdirSync } = await import('fs');
      const { join } = await import('pathe');

      const isGit = await isGitRepository(cwd);
      if (!isGit) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const gitRoot = await getGitRoot(cwd);
      const mainBranch = await detectMainBranch(gitRoot);
      await updateMainBranch(gitRoot, mainBranch, skipUpdate);

      const workspaceName = name || (await generateWorkspaceName(gitRoot));

      const workspacesDir = join(gitRoot, `.${context.productName}-workspaces`);
      if (!existsSync(workspacesDir)) {
        mkdirSync(workspacesDir, { recursive: true });
      }

      const worktree = await createWorktree(gitRoot, workspaceName, {
        baseBranch: mainBranch,
        workspacesDir: `.${context.productName}-workspaces`,
      });

      await addToGitExclude(gitRoot);

      return {
        success: true,
        data: {
          workspace: {
            name: worktree.name,
            path: worktree.path,
            branch: worktree.branch,
          },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create workspace',
      };
    }
  });

  messageBus.registerHandler('project.workspaces.delete', async (data) => {
    const { cwd, name, force = false } = data;
    try {
      await getContext(cwd);
      const { getGitRoot, isGitRepository, deleteWorktree } = await import(
        '../../worktree'
      );

      const isGit = await isGitRepository(cwd);
      if (!isGit) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const gitRoot = await getGitRoot(cwd);
      await deleteWorktree(gitRoot, name, force);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to delete workspace',
      };
    }
  });

  messageBus.registerHandler('project.workspaces.merge', async (data) => {
    const { cwd, name } = data;
    try {
      await getContext(cwd);
      const { getGitRoot, isGitRepository, listWorktrees, mergeWorktree } =
        await import('../../worktree');

      const isGit = await isGitRepository(cwd);
      if (!isGit) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const gitRoot = await getGitRoot(cwd);
      const worktrees = await listWorktrees(gitRoot);
      const worktree = worktrees.find((w) => w.name === name);

      if (!worktree) {
        return {
          success: false,
          error: `Workspace '${name}' not found`,
        };
      }

      await mergeWorktree(gitRoot, worktree);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to merge workspace',
      };
    }
  });

  messageBus.registerHandler(
    'project.workspaces.createGithubPR',
    async (data) => {
      const { cwd, name, title, description = '', baseBranch } = data;
      try {
        await getContext(cwd);
        const {
          getGitRoot,
          isGitRepository,
          listWorktrees,
          ensureCleanWorkingDirectory,
          detectMainBranch,
        } = await import('../../worktree');
        const { promisify } = await import('util');
        const execPromise = promisify((await import('child_process')).exec);

        const isGit = await isGitRepository(cwd);
        if (!isGit) {
          return {
            success: false,
            error: 'Not a git repository',
          };
        }

        const gitRoot = await getGitRoot(cwd);
        const worktrees = await listWorktrees(gitRoot);
        const worktree = worktrees.find((w) => w.name === name);

        if (!worktree) {
          return {
            success: false,
            error: `Workspace '${name}' not found`,
          };
        }

        await ensureCleanWorkingDirectory(worktree.path);

        try {
          await execPromise(`git push origin ${worktree.branch}`, {
            cwd: worktree.path,
          });
        } catch (error: any) {
          return {
            success: false,
            error: `Failed to push branch: ${error.message}`,
          };
        }

        const targetBranch = baseBranch || (await detectMainBranch(gitRoot));

        const prTitle =
          title ||
          worktree.branch
            .replace('workspace/', '')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase());

        try {
          const ghCommand = [
            'gh pr create',
            `--base ${targetBranch}`,
            `--head ${worktree.branch}`,
            `--title "${prTitle}"`,
            description ? `--body "${description}"` : '--body ""',
          ].join(' ');

          const { stdout } = await execPromise(ghCommand, {
            cwd: worktree.path,
          });

          const prUrl = stdout.trim();
          const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
          const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

          return {
            success: true,
            data: {
              prUrl,
              prNumber,
            },
          };
        } catch (error: any) {
          if (error.message?.includes('gh: command not found')) {
            return {
              success: false,
              error:
                'GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/',
            };
          }
          if (error.message?.includes('not authenticated')) {
            return {
              success: false,
              error:
                'GitHub CLI is not authenticated. Please run: gh auth login',
            };
          }
          if (error.message?.includes('already exists')) {
            return {
              success: false,
              error: 'A pull request already exists for this branch',
            };
          }
          return {
            success: false,
            error: `Failed to create PR: ${error.message}`,
          };
        }
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to create GitHub PR',
        };
      }
    },
  );

  messageBus.registerHandler('project.generateCommit', async (data) => {
    const { cwd, language = 'English', systemPrompt, model } = data;
    try {
      if (model) {
        const context = await getContext(cwd);
        const { error } = await resolveModelWithContext(model, context);
        if (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const { getStagedDiff, getStagedFileList } = await import(
        '../../utils/git'
      );

      const diff = data.diff ?? (await getStagedDiff(cwd));
      const fileList = data.fileList ?? (await getStagedFileList(cwd));

      if (
        (!diff || diff.length === 0) &&
        (!fileList || fileList.length === 0)
      ) {
        return {
          success: false,
          error: 'No staged changes to commit',
        };
      }

      const userPrompt = `
# Staged files:
${fileList}

# Diffs:
${diff}
      `.trim();

      const finalSystemPrompt = createGenerateCommitSystemPrompt(
        language,
        systemPrompt,
      );

      const result = await messageBus.messageHandlers.get('utils.quickQuery')?.(
        {
          cwd,
          userPrompt,
          systemPrompt: finalSystemPrompt,
          model,
          responseFormat: {
            type: 'json',
            schema: z.toJSONSchema(
              z.object({
                commitMessage: z.string(),
                branchName: z.string(),
                isBreakingChange: z.boolean(),
                summary: z.string(),
              }),
            ),
          },
        },
      );

      if (!result?.success) {
        return {
          success: false,
          error: result?.error || 'Failed to generate commit message',
        };
      }

      let jsonResponse;
      try {
        const cleanedText = sanitizeAIResponse(result.data.text);
        jsonResponse = JSON.parse(cleanedText);
      } catch (parseError: any) {
        return {
          success: false,
          error: `Failed to parse commit message response: ${parseError.message}\n\nRaw response:\n${result.data.text}`,
        };
      }

      return {
        success: true,
        data: {
          commitMessage: jsonResponse.commitMessage,
          branchName: jsonResponse.branchName,
          isBreakingChange: jsonResponse.isBreakingChange,
          summary: jsonResponse.summary,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to generate commit',
      };
    }
  });
}
