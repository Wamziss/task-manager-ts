# Decentralized Task Manager

Welcome to the Decentralized Task Manager! This project lets you manage your tasks on the Internet Computer, keeping your to-do list secure and accessible from anywhere.

## What's This All About?

This task manager helps you:

- Create new tasks with titles, descriptions, due dates, and priorities
- Assign tasks to different users
- Update task status (pending, in progress, completed)
- Add comments to tasks
- Search and filter your tasks
- Get a quick overview of your task statistics

The cool part? It's all decentralized, running on the Internet Computer!

## Getting Started

Here's how to get this project up and running on your machine:

### What You Need

- Node.js (version 14 or higher)
- npm (usually comes with Node.js)
- DFX (the DFINITY command-line tool)
- Git

### Setting Up

1. Clone this repository:
   ```
   git clone https://github.com/Wamziss/task-manager-ts.git
   cd task-manager-ts
   ```

2. Install the project dependencies:
   ```
   npm install
   ```

3. Start the local Internet Computer replica:
   ```
   dfx start --background
   ```

4. Deploy the canister:
   ```
   dfx deploy
   ```

### Using the Task Manager

After deploying, you'll see some URLs in your terminal. The url to use starts with `http://localhost:`. Open that in your web browser to start using the task manager!

## How It Works

This task manager is built using:

- TypeScript: For writing smart, type-safe code
- Azle: A tool that helps us write Internet Computer canisters in TypeScript
- Express: A popular web framework that makes it easy to create APIs

The main parts of the code are:

- Task creation and management
- User-specific task lists
- Task searching and filtering
- Task statistics generation

## Need Help?

If you run into any problems or have questions, feel free to open an issue in this repository. We're here to help!

## Want to Contribute?

We'd love your help making this task manager even better! If you have ideas or want to fix a bug:

1. Fork the repository
2. Create a new branch for your changes
3. Make your changes and commit them
4. Push to your fork and submit a pull request
