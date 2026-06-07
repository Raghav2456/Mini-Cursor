# Mini Cursor: AI-Powered Frontend Code Generator

Mini Cursor is a GenAI-powered web application that converts natural language prompts into complete frontend projects. It uses a Node.js backend with the Google Gemini API to generate folders, files, and code automatically.

## Features

- Generate frontend projects from natural language prompts
- Automatically create project folders and files
- Generate HTML, CSS, and JavaScript code
- Live preview for generated projects
- Code viewer to inspect generated files
- Activity logs to track executed commands
- Prompt history using browser local storage

## Tech Stack

- Node.js
- JavaScript
- HTML
- CSS
- Google Gemini API

## How It Works

1. User enters a project prompt in the browser.
2. The Node.js backend sends the prompt to Gemini.
3. The AI agent plans and executes terminal commands.
4. Files and folders are created automatically.
5. The generated project can be previewed and inspected from the UI.

## Installation

Install all dependencies:

```bash
npm install
```

## Run Project

Start the development server:

```bash
npm run dev
```
