import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { randomUUID } from '../../utils/randomUUID';
import type { PreviewSkillsResult } from '../../skill';

export function registerSkillsHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
  skillPreviews: Map<string, PreviewSkillsResult>,
) {
  messageBus.registerHandler('skills.list', async (data) => {
    const { cwd } = data;
    try {
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      await skillManager.loadSkills();
      return {
        success: true,
        data: {
          skills: skillManager.getSkills(),
          errors: skillManager.getErrors(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          skills: [],
          errors: [
            { path: cwd, message: error.message || 'Failed to list skills' },
          ],
        },
      };
    }
  });

  messageBus.registerHandler('skills.get', async (data) => {
    const { cwd, name } = data;
    try {
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      await skillManager.loadSkills();
      const skill = skillManager.getSkill(name);
      if (!skill) {
        return {
          success: false,
          error: `Skill "${name}" not found`,
        };
      }
      const body = await skillManager.readSkillBody(skill);
      return {
        success: true,
        data: {
          skill: { ...skill, body },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get skill',
      };
    }
  });

  messageBus.registerHandler('skills.add', async (data) => {
    const { cwd, source, global, claude, overwrite, name, targetDir } = data;
    try {
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      const result = await skillManager.addSkill(source, {
        global,
        claude,
        overwrite,
        name,
        targetDir,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to add skill',
      };
    }
  });

  messageBus.registerHandler('skills.remove', async (data) => {
    const { cwd, name, targetDir } = data;
    try {
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      await skillManager.loadSkills();
      const result = await skillManager.removeSkill(name, targetDir);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to remove skill',
      };
    }
  });

  messageBus.registerHandler('skills.preview', async (data) => {
    const { cwd, source } = data;
    try {
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      const preview = await skillManager.previewSkills(source);
      const previewId = randomUUID();
      skillPreviews.set(previewId, preview);
      return {
        success: true,
        data: {
          previewId,
          skills: preview.skills.map((s) => ({
            name: s.name,
            description: s.description,
            skillPath: s.skillPath,
          })),
          errors: preview.errors,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to preview skills',
      };
    }
  });

  messageBus.registerHandler('skills.install', async (data) => {
    const {
      cwd,
      previewId,
      selectedSkills,
      source,
      global,
      claude,
      overwrite,
      name,
      targetDir,
    } = data;
    try {
      const preview = skillPreviews.get(previewId);
      if (!preview) {
        return {
          success: false,
          error: 'Preview not found or expired',
        };
      }
      const context = await getContext(cwd);
      const { SkillManager } = await import('../../skill');
      const skillManager = new SkillManager({ context });
      const skillsToInstall = preview.skills.filter((s) =>
        selectedSkills.includes(s.name),
      );
      const result = await skillManager.installFromPreview(
        preview,
        skillsToInstall,
        source,
        {
          global,
          claude,
          overwrite,
          name,
          targetDir,
        },
      );
      skillManager.cleanupPreview(preview);
      skillPreviews.delete(previewId);
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to install skills',
      };
    }
  });
}
