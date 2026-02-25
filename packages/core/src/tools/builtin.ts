import { readFile, writeFile, mkdir, readdir, stat, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDefinition, ToolHandler, ToolContext } from "./types.js";

/**
 * Built-in tool: read_file
 */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Returns the file content as a string.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read (relative to working directory)",
      },
    },
    required: ["path"],
  },
  riskLevel: "low",
};

export const readFileHandler: ToolHandler = async (
  params: Record<string, unknown>,
  context: ToolContext
) => {
  const filePath = params.path as string;
  const absolutePath = resolve(context.cwd, filePath);

  try {
    const content = await readFile(absolutePath, "utf-8");
    return { content, path: filePath };
  } catch (error) {
    throw new Error(`Failed to read file "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Built-in tool: write_file
 */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write (relative to working directory)",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  riskLevel: "medium",
};

export const writeFileHandler: ToolHandler = async (
  params: Record<string, unknown>,
  context: ToolContext
) => {
  const filePath = params.path as string;
  const content = params.content as string;
  const absolutePath = resolve(context.cwd, filePath);

  try {
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content, "utf-8");
    return { success: true, path: filePath, bytesWritten: content.length };
  } catch (error) {
    throw new Error(`Failed to write file "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Built-in tool: list_directory
 */
export const listDirectoryTool: ToolDefinition = {
  name: "list_directory",
  description: "List the contents of a directory. Returns an array of file and directory names.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the directory to list (relative to working directory). Defaults to current directory.",
      },
    },
    required: [],
  },
  riskLevel: "low",
};

export const listDirectoryHandler: ToolHandler = async (
  params: Record<string, unknown>,
  context: ToolContext
) => {
  const dirPath = (params.path as string) || ".";
  const absolutePath = resolve(context.cwd, dirPath);

  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
    return { path: dirPath, items };
  } catch (error) {
    throw new Error(`Failed to list directory "${dirPath}": ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Built-in tool: file_exists
 */
export const fileExistsTool: ToolDefinition = {
  name: "file_exists",
  description: "Check if a file or directory exists at the given path.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to check (relative to working directory)",
      },
    },
    required: ["path"],
  },
  riskLevel: "low",
};

export const fileExistsHandler: ToolHandler = async (
  params: Record<string, unknown>,
  context: ToolContext
) => {
  const filePath = params.path as string;
  const absolutePath = resolve(context.cwd, filePath);

  try {
    await access(absolutePath);
    const stats = await stat(absolutePath);
    return {
      exists: true,
      path: filePath,
      type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
    };
  } catch {
    return { exists: false, path: filePath };
  }
};

/**
 * All built-in tools.
 */
export const builtinTools: Array<{ definition: ToolDefinition; handler: ToolHandler }> = [
  { definition: readFileTool, handler: readFileHandler },
  { definition: writeFileTool, handler: writeFileHandler },
  { definition: listDirectoryTool, handler: listDirectoryHandler },
  { definition: fileExistsTool, handler: fileExistsHandler },
];
