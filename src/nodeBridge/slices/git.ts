import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';

export function registerGitHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
  abortControllers: Map<string, AbortController>,
) {
  messageBus.registerHandler('git.status', async (data) => {
    const { cwd } = data;
    try {
      const {
        isGitInstalled,
        isGitRepository,
        hasUncommittedChanges,
        isGitUserConfigured,
        getUnstagedFiles,
        hasOriginRemote,
      } = await import('../../utils/git');
      const { getStagedFileList } = await import('../../utils/git');
      const { existsSync } = await import('fs');
      const { join } = await import('path');
      const { getGitRoot } = await import('../../worktree');

      const gitInstalled = await isGitInstalled();
      if (!gitInstalled) {
        return {
          success: true,
          data: {
            isRepo: false,
            hasUncommittedChanges: false,
            hasStagedChanges: false,
            isGitInstalled: false,
            isUserConfigured: { name: false, email: false },
            isMerging: false,
            unstagedFiles: [],
            hasRemote: false,
          },
        };
      }

      const isRepo = await isGitRepository(cwd);
      if (!isRepo) {
        return {
          success: true,
          data: {
            isRepo: false,
            hasUncommittedChanges: false,
            hasStagedChanges: false,
            isGitInstalled: true,
            isUserConfigured: { name: false, email: false },
            isMerging: false,
            unstagedFiles: [],
            hasRemote: false,
          },
        };
      }

      const [
        hasChanges,
        userConfig,
        stagedFiles,
        gitRoot,
        unstagedFiles,
        remoteExists,
      ] = await Promise.all([
        hasUncommittedChanges(cwd),
        isGitUserConfigured(cwd),
        getStagedFileList(cwd),
        getGitRoot(cwd),
        getUnstagedFiles(cwd),
        hasOriginRemote(cwd),
      ]);

      const isMerging = existsSync(join(gitRoot, '.git', 'MERGE_HEAD'));

      return {
        success: true,
        data: {
          isRepo: true,
          hasUncommittedChanges: hasChanges,
          hasStagedChanges: stagedFiles.length > 0,
          isGitInstalled: true,
          isUserConfigured: userConfig,
          isMerging,
          unstagedFiles,
          hasRemote: remoteExists,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get git status',
      };
    }
  });

  messageBus.registerHandler('git.stage', async (data) => {
    const { cwd, all = true } = data;
    try {
      const { stageAll } = await import('../../utils/git');

      if (all) {
        await stageAll(cwd);
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to stage changes',
      };
    }
  });

  messageBus.registerHandler('git.commit', async (data) => {
    const { cwd, message, noVerify = false } = data;
    try {
      const { gitCommit } = await import('../../utils/git');
      await gitCommit(cwd, message, noVerify, (line, stream) => {
        messageBus.emitEvent('git.commit.output', { line, stream });
      });
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to commit changes',
      };
    }
  });

  messageBus.registerHandler('git.push', async (data) => {
    const { cwd } = data;
    try {
      const { gitPush, hasOriginRemote } = await import('../../utils/git');

      const remoteExists = await hasOriginRemote(cwd);
      if (!remoteExists) {
        return {
          success: false,
          error: 'No origin remote configured',
        };
      }

      await gitPush(cwd, (line, stream) => {
        messageBus.emitEvent('git.push.output', { line, stream });
      });
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to push changes',
      };
    }
  });

  messageBus.registerHandler('git.createBranch', async (data) => {
    const { cwd, name } = data;
    try {
      const { createAndCheckoutBranch, branchExists } = await import(
        '../../utils/git'
      );

      const exists = await branchExists(cwd, name);
      if (exists) {
        const timestamp = new Date()
          .toISOString()
          .slice(0, 16)
          .replace(/[-:]/g, '');
        const newName = `${name}-${timestamp}`;
        await createAndCheckoutBranch(cwd, newName);
        return {
          success: true,
          data: { branchName: newName, wasRenamed: true },
        };
      }

      await createAndCheckoutBranch(cwd, name);
      return { success: true, data: { branchName: name, wasRenamed: false } };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create branch',
      };
    }
  });

  messageBus.registerHandler('git.detectGitHub', async (data) => {
    const { cwd } = data;
    try {
      const { execSync } = await import('child_process');

      let hasGhCli = false;
      try {
        execSync('which gh', { stdio: 'ignore' });
        hasGhCli = true;
      } catch {
        // gh CLI not installed
      }

      let isGitHubRemote = false;
      try {
        const remoteUrl = execSync('git config remote.origin.url', {
          cwd,
          encoding: 'utf-8',
        }).trim();
        isGitHubRemote = /(github\.com|github:|git@github)/.test(remoteUrl);
      } catch {
        // No remote or git error
      }

      return {
        success: true,
        data: {
          hasGhCli,
          isGitHubRemote,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to detect GitHub',
      };
    }
  });

  messageBus.registerHandler('git.createPR', async (data) => {
    const { cwd, body } = data;
    try {
      const { spawn } = await import('child_process');

      const args = ['pr', 'create', '--fill'];
      if (body) {
        args.push('--body', body);
      }

      return new Promise((resolve) => {
        const ghProcess = spawn('gh', args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        ghProcess.stdout.on('data', (chunk) => {
          const line = chunk.toString();
          stdout += line;
          messageBus.emitEvent('git.pr.output', {
            line: line.trim(),
            stream: 'stdout',
          });
        });

        ghProcess.stderr.on('data', (chunk) => {
          const line = chunk.toString();
          stderr += line;
          messageBus.emitEvent('git.pr.output', {
            line: line.trim(),
            stream: 'stderr',
          });
        });

        ghProcess.on('close', (code) => {
          if (code === 0) {
            const prUrl = stdout.trim();
            resolve({
              success: true,
              data: { prUrl },
            });
          } else {
            const errorMessage = stderr.trim() || 'Failed to create PR';
            let hint = '';

            if (
              errorMessage.includes('not logged') ||
              errorMessage.includes('auth')
            ) {
              hint =
                '\n\nHint: Run `gh auth login` to authenticate with GitHub.';
            } else if (errorMessage.includes('already exists')) {
              hint = '\n\nHint: A pull request already exists for this branch.';
            } else if (
              errorMessage.includes('No commits between') ||
              errorMessage.includes("sha can't be blank")
            ) {
              hint =
                '\n\nHint: Make sure your branch is pushed to remote and has commits ahead of the base branch.';
            }

            resolve({
              success: false,
              error: errorMessage + hint,
            });
          }
        });

        ghProcess.on('error', (err) => {
          resolve({
            success: false,
            error: `Failed to run gh CLI: ${err.message}\n\nHint: Make sure gh CLI is installed and in your PATH.`,
          });
        });
      });
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create PR',
      };
    }
  });

  messageBus.registerHandler('git.clone', async (data) => {
    const { url, destination, taskId } = data;
    const { cloneRepository } = await import('../../utils/git');

    let abortController: AbortController | undefined;
    if (taskId) {
      abortController = new AbortController();
      abortControllers.set(taskId, abortController);
    }

    try {
      const result = await cloneRepository({
        url,
        destination,
        signal: abortController?.signal,
        timeoutMinutes: process.env.GIT_CLONE_TIMEOUT_MINUTES
          ? Number.parseInt(process.env.GIT_CLONE_TIMEOUT_MINUTES, 10)
          : 30,
        onProgress: (progress) => {
          messageBus.emitEvent('git.clone.progress', {
            taskId,
            percent: progress.percent,
            message: progress.message,
          });
        },
      });

      if (result.success) {
        return {
          success: true,
          data: {
            clonePath: result.clonePath,
            repoName: result.repoName,
          },
        };
      }
      return result;
    } catch (error: any) {
      if (taskId && abortControllers.has(taskId)) {
        abortControllers.delete(taskId);
      }
      throw error;
    } finally {
      if (taskId && abortControllers.has(taskId)) {
        abortControllers.delete(taskId);
      }
    }
  });

  messageBus.registerHandler('git.clone.cancel', async (data) => {
    const { taskId } = data;
    const controller = abortControllers.get(taskId);

    if (controller) {
      controller.abort();
      abortControllers.delete(taskId);
      return { success: true };
    }
    return {
      success: false,
      error: 'Clone task not found or already completed',
    };
  });
}
