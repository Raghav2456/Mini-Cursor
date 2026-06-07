import { GoogleGenAI } from "@google/genai";
import { exec } from "child_process";
import { promisify } from "util";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";

const asyncExecute = promisify(exec);
const platform = os.platform();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const workspaceDir = __dirname;

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  "AQ.Ab8RN6KrdTnX0QiVNJHb4R1wcvecQDjXKezCORBKs3HhR2atDQ";

const ai = new GoogleGenAI({ apiKey });

async function executeCommand({ command }) {
  try {
    const { stdout, stderr } = await asyncExecute(command, {
      cwd: workspaceDir,
      timeout: 120000,
      windowsHide: true,
    });

    if (stderr) {
      return `Error: ${stderr}`;
    }

    return `Success: ${stdout || "Command completed"} || Task executed completely`;
  } catch (error) {
    return `Error: ${error.message || error}`;
  }
}

const executeCommandDeclaration = {
  name: "executeCommand",
  description:
    "Execute a single terminal/shell command. A command can create folders, create files, write files, edit files, list files, or run validation commands.",
  parameters: {
    type: "OBJECT",
    properties: {
      command: {
        type: "string",
        description: 'A single terminal command. Example: "mkdir calculator"',
      },
    },
    required: ["command"],
  },
};

const availableTools = {
  executeCommand,
};

function getSystemInstruction() {
  return `You are an expert AI agent specializing in automated frontend web development. Your goal is to build a complete, functional frontend website or small app based on the user's request. You operate by executing terminal commands one at a time using the 'executeCommand' tool.

Your user's operating system is: ${platform}
Your working directory is: ${workspaceDir}

<-- Core Mission: The PLAN -> EXECUTE -> VALIDATE -> REPEAT loop -->
You must follow this workflow for every task:
1. PLAN: Decide on the single, next logical command to execute.
2. EXECUTE: Call the 'executeCommand' tool with that single command.
3. VALIDATE: Carefully examine the result from the tool. The result starts with "Success:" or "Error:".
   - If "Success:", check stdout to confirm the command did what you expected.
   - If "Error:", analyze the message and formulate a new command to fix the problem.
4. REPEAT: Continue until the user's request is fully completed.

<-- CRITICAL RULES for Writing to Files -->
IF the OS is Linux or macOS ('linux' or 'darwin'):
- To write multi-line code to a file, use cat with a here-document.
- Use single quotes around EOF to prevent shell expansion.

IF the OS is Windows ('win32'):
- To write multi-line code to a file, use PowerShell's Set-Content cmdlet with a here-string.
- Syntax: @' ... multiline content here ... '@ | Set-Content -Path "path\\to\\file.js"
- Use backslashes for Windows paths.

ABSOLUTE RULE: Do not use a single echo command for writing complex files.

<-- Standard Project Plan -->
Unless the user specifies otherwise:
1. Create one top-level project folder.
2. Verify the folder exists.
3. Create index.html, style.css, and script.js inside it.
4. Populate HTML, CSS, and JS with complete working code.
5. Read each file back after writing it to validate.

<-- Final Step -->
Once all files are created and validated, respond with a short plain-text summary and the project folder path.`;
}

async function runAgent(userProblem) {
  const history = [
    {
      role: "user",
      parts: [{ text: userProblem }],
    },
  ];
  const steps = [];

  while (true) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history,
      config: {
        systemInstruction: getSystemInstruction(),
        tools: [
          {
            functionDeclarations: [executeCommandDeclaration],
          },
        ],
      },
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const functionCall = response.functionCalls[0];
      const { name, args } = functionCall;
      const tool = availableTools[name];

      if (!tool) {
        throw new Error(`Unknown tool requested: ${name}`);
      }

      steps.push({
        type: "command",
        command: args.command,
      });

      const result = await tool(args);

      steps.push({
        type: result.startsWith("Success:") ? "success" : "error",
        output: result,
      });

      history.push({
        role: "model",
        parts: [
          {
            functionCall,
          },
        ],
      });

      history.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: {
                result,
              },
            },
          },
        ],
      });

      continue;
    }

    const finalText = response.text || "Done.";
    history.push({
      role: "model",
      parts: [{ text: finalText }],
    });
    steps.push({
      type: "final",
      output: finalText,
    });

    return {
      reply: finalText,
      steps,
      files: await getWorkspaceFiles(),
    };
  }
}

async function getWorkspaceFiles() {
  const ignored = new Set(["node_modules", ".git"]);
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (ignored.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workspaceDir, fullPath);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(relativePath.replaceAll("\\", "/"));
      }
    }
  }

  await walk(workspaceDir);
  return files.sort();
}

function resolveWorkspacePath(relativePath) {
  const normalizedPath = path.normalize(relativePath || "");
  const fullPath = path.resolve(workspaceDir, normalizedPath);

  if (!fullPath.startsWith(workspaceDir)) {
    throw new Error("Path is outside workspace.");
  }

  if (fullPath.includes(`${path.sep}node_modules${path.sep}`) || fullPath.includes(`${path.sep}.git${path.sep}`)) {
    throw new Error("This path is not allowed.");
  }

  return fullPath;
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };

  return types[extension] || "application/octet-stream";
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/generate") {
      const body = JSON.parse(await readRequestBody(request));
      const prompt = String(body.prompt || "").trim();

      if (!prompt) {
        await sendJson(response, 400, { error: "Prompt is required." });
        return;
      }

      const result = await runAgent(prompt);
      await sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/files") {
      await sendJson(response, 200, { files: await getWorkspaceFiles() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/file") {
      const relativePath = url.searchParams.get("path");
      const filePath = resolveWorkspacePath(relativePath);
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        await sendJson(response, 400, { error: "Path is not a file." });
        return;
      }

      const content = await fs.readFile(filePath, "utf8");
      await sendJson(response, 200, { path: relativePath, content });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
      const relativePath = decodeURIComponent(url.pathname.replace("/preview/", ""));
      const filePath = resolveWorkspacePath(relativePath);
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": getContentType(filePath),
      });
      response.end(content);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    await sendJson(response, 500, {
      error: error.message || "Something went wrong.",
    });
  }
});

server.listen(port, () => {
  console.log(`Mini Cursor is running at http://localhost:${port}`);
});
