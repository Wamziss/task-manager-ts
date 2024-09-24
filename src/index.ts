import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic, Principal, Opt } from 'azle';
import express from 'express';

// Define types
type TaskId = string;
type UserId = Principal;

enum TaskStatus {
    Pending = 'pending',
    InProgress = 'in_progress',
    Completed = 'completed'
}

enum TaskPriority {
    Low = 'low',
    Medium = 'medium',
    High = 'high'
}

class Task {
    id: TaskId;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: Opt<UserId>;
    dueDate: Opt<Date>;
    createdAt: Date;
    updatedAt: Date;
    comments: Comment[];
}

class Comment {
    id: string;
    content: string;
    author: UserId;
    createdAt: Date;
}

// Initialize storage
const tasksStorage = StableBTreeMap<TaskId, Task>(0);
const userTasksStorage = StableBTreeMap<UserId, TaskId[]>(1);

export default Server(() => {
    const app = express();
    app.use(express.json());

    // Create a new task
    app.post("/tasks", (req, res) => {
    try {
        const caller = ic.caller();
        
        // Validate title and description
        if (!req.body.title || typeof req.body.title !== 'string' || req.body.title.trim() === "") {
            return res.status(400).send("Task title is required and must be a valid string.");
        }
        if (!req.body.description || typeof req.body.description !== 'string' || req.body.description.trim() === "") {
            return res.status(400).send("Task description is required and must be a valid string.");
        }

        // Validate priority
        const validPriorities = Object.values(TaskPriority);
        if (req.body.priority && !validPriorities.includes(req.body.priority)) {
            return res.status(400).send("Invalid task priority.");
        }

        // Validate assignee if provided
        let assignee: Opt<UserId> = { None: null };
        if (req.body.assignee) {
            try {
                assignee = { Some: Principal.fromText(req.body.assignee) };
            } catch (error) {
                return res.status(400).send("Invalid assignee principal ID.");
            }
        }

        // Validate due date if provided
        let dueDate: Opt<Date> = { None: null };
        if (req.body.dueDate) {
            const dueDateObj = new Date(req.body.dueDate);
            if (isNaN(dueDateObj.getTime())) {
                return res.status(400).send("Invalid due date format.");
            }
            dueDate = { Some: dueDateObj };
        }

        // Create task object
        const task: Task = {
            id: uuidv4(),
            title: req.body.title,
            description: req.body.description,
            status: TaskStatus.Pending,
            priority: req.body.priority || TaskPriority.Medium,
            assignee: assignee,
            dueDate: dueDate,
            createdAt: getCurrentDate(),
            updatedAt: getCurrentDate(),
            comments: []
        };

        // Insert task into storage
        const insertResult = tasksStorage.insert(task.id, task);
        if (!insertResult) {
            return res.status(500).send("Failed to create task.");
        }

        // Add task to the user's task list
        const addTaskResult = addTaskToUser(caller, task.id);
        if (!addTaskResult) {
            tasksStorage.remove(task.id); // Rollback if task-to-user association fails
            return res.status(500).send("Failed to associate task with the user.");
        }

        res.status(201).json(task);

    } catch (error) {
        console.error("Error creating task:", error);
        res.status(500).send("An unexpected error occurred.");
    }
});

    // Get all tasks for the caller
    app.get("/tasks", (req, res) => {
    try {
        const caller = ic.caller();
        const userTasks = getUserTasks(caller);

        // Handle the case where the user has no tasks
        if (userTasks.length === 0) {
            return res.status(200).json([]); // Return an empty array if no tasks
        }

        // Retrieve tasks, handle errors, and filter task data
        const tasks = userTasks
            .map(taskId => {
                const taskOpt = tasksStorage.get(taskId);
                if ("None" in taskOpt) {
                    console.warn(`Task with id=${taskId} not found in storage.`);
                    return null;
                }
                return taskOpt.Some;
            })
            .filter((task): task is Task => task !== null) // Filter out any null results
            .map(task => ({
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
                assignee: task.assignee.Some || null,  // Return assignee if exists
                dueDate: task.dueDate.Some || null,    // Return due date if exists
                createdAt: task.createdAt,
                updatedAt: task.updatedAt
            }));

        res.status(200).json(tasks);
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).send("An unexpected error occurred while fetching tasks.");
    }
});

    // Get a specific task
    app.get("/tasks/:id", (req, res) => {
    try {
        const taskId = req.params.id;
        const caller = ic.caller();

        // Retrieve the task from storage
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
            return res.status(404).send(`Task with id=${taskId} not found.`);
        }

        const task = taskOpt.Some;

        // Authorization check: ensure the caller is the task creator or assignee
        const userTasks = getUserTasks(caller);
        const isAuthorizedUser = userTasks.includes(taskId) || 
                                 ("Some" in task.assignee && task.assignee.Some === caller);

        if (!isAuthorizedUser) {
            return res.status(403).send("You are not authorized to access this task.");
        }

        // Return only necessary fields
        const filteredTask = {
            id: task.id,
            title: task.title,
            description: task.description,   // Include description if required
            status: task.status,
            priority: task.priority,
            assignee: task.assignee.Some || null,
            dueDate: task.dueDate.Some || null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            comments: task.comments.map(comment => ({
                id: comment.id,
                content: comment.content,
                author: comment.author,
                createdAt: comment.createdAt
            }))
        };

        res.status(200).json(filteredTask);
    } catch (error) {
        console.error("Error fetching task:", error);
        res.status(500).send("An unexpected error occurred while fetching the task.");
    }
});

    // Update a task
    app.put("/tasks/:id", (req, res) => {
    try {
        const taskId = req.params.id;
        const caller = ic.caller();

        // Retrieve the task from storage
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
            return res.status(404).send(`Task with id=${taskId} not found.`);
        }

        const task = taskOpt.Some;

        // Authorization check: ensure the caller is either the task creator or the assignee
        const userTasks = getUserTasks(caller);
        const isAuthorizedUser = userTasks.includes(taskId) || 
                                 ("Some" in task.assignee && task.assignee.Some === caller);

        if (!isAuthorizedUser) {
            return res.status(403).send("You are not authorized to update this task.");
        }

        // Input validation
        if (req.body.title && (typeof req.body.title !== 'string' || req.body.title.trim() === "")) {
            return res.status(400).send("Task title must be a non-empty string.");
        }
        if (req.body.description && (typeof req.body.description !== 'string' || req.body.description.trim() === "")) {
            return res.status(400).send("Task description must be a non-empty string.");
        }

        const validStatuses = Object.values(TaskStatus);
        if (req.body.status && !validStatuses.includes(req.body.status)) {
            return res.status(400).send("Invalid task status.");
        }

        const validPriorities = Object.values(TaskPriority);
        if (req.body.priority && !validPriorities.includes(req.body.priority)) {
            return res.status(400).send("Invalid task priority.");
        }

        let assignee = task.assignee;
        if (req.body.assignee) {
            try {
                assignee = { Some: Principal.fromText(req.body.assignee) };
            } catch (error) {
                return res.status(400).send("Invalid assignee principal ID.");
            }
        }

        let dueDate = task.dueDate;
        if (req.body.dueDate) {
            const dueDateObj = new Date(req.body.dueDate);
            if (isNaN(dueDateObj.getTime())) {
                return res.status(400).send("Invalid due date format.");
            }
            dueDate = { Some: dueDateObj };
        }

        // Create the updated task object
        const updatedTask: Task = {
            ...task,
            title: req.body.title || task.title,
            description: req.body.description || task.description,
            status: req.body.status || task.status,
            priority: req.body.priority || task.priority,
            assignee: assignee,
            dueDate: dueDate,
            updatedAt: getCurrentDate()  // Update the last updated timestamp
        };

        // Attempt to update the task in storage
        const insertResult = tasksStorage.insert(taskId, updatedTask);
        if (!insertResult) {
            return res.status(500).send("Failed to update task.");
        }

        res.status(200).json({
            id: updatedTask.id,
            title: updatedTask.title,
            description: updatedTask.description,
            status: updatedTask.status,
            priority: updatedTask.priority,
            assignee: updatedTask.assignee.Some || null,
            dueDate: updatedTask.dueDate.Some || null,
            createdAt: updatedTask.createdAt,
            updatedAt: updatedTask.updatedAt
        });
    } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).send("An unexpected error occurred while updating the task.");
    }
});

    // Delete a task
    app.delete("/tasks/:id", (req, res) => {
        try {
        const taskId = req.params.id;
            const caller = ic.caller();

            // Retrieve the task from storage
            const taskOpt = tasksStorage.get(taskId);
            if ("None" in taskOpt) {
                return res.status(404).send(`Task with id=${taskId} not found.`);
            }

            const task = taskOpt.Some;

            // Authorization check: ensure the caller is either the task creator or the assignee
            const userTasks = getUserTasks(caller);
            const isAuthorizedUser = userTasks.includes(taskId) ||
                ("Some" in task.assignee && task.assignee.Some === caller);

            if (!isAuthorizedUser) {
                return res.status(403).send("You are not authorized to delete this task.");
            }

            // Remove the task from storage
        const deletedTask = tasksStorage.remove(taskId);
        if ("None" in deletedTask) {
                return res.status(404).send(`Task with id=${taskId} not found`);
            }

            // Remove the task from the user's task list
            removeTaskFromUser(caller, taskId);

            res.json(deletedTask.Some);
        } catch (error) {
            console.error("Error deleting task:", error);
            res.status(500).send("An unexpected error occurred while deleting the task.");
        }
    });

    // Add a comment to a task
    app.post("/tasks/:id/comments", (req, res) => {
        try {
        const taskId = req.params.id;
            const caller = ic.caller();

            // Retrieve the task from storage
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
                return res.status(404).send(`Task with id=${taskId} not found`);
            }

            const task = taskOpt.Some;

            // Authorization check: ensure the caller is either the task creator or the assignee
            const userTasks = getUserTasks(caller);
            const isAuthorizedUser = userTasks.includes(taskId) ||
                ("Some" in task.assignee && task.assignee.Some === caller);

            if (!isAuthorizedUser) {
                return res.status(403).send("You are not authorized to add a comment to this task.");
            }

            // Validate comment content
            if (!req.body.content || typeof req.body.content !== 'string' || req.body.content.trim() === "") {
                return res.status(400).send("Comment content is required and must be a valid string.");
            }

            // Create comment object
            const comment: Comment = {
                id: uuidv4(),
                content: req.body.content,
                author: caller,
                createdAt: getCurrentDate()
            };

            // Add comment to the task
            task.comments.push(comment);
            task.updatedAt = getCurrentDate();
            tasksStorage.insert(taskId, task);

            res.status(201).json(comment);
        } catch (error) {
            console.error("Error adding comment:", error);
            res.status(500).send("An unexpected error occurred while adding the comment.");
        }
    });

    // Search tasks
    app.get("/tasks/search", (req, res) => {
        try {
        const caller = ic.caller();
        const userTasks = getUserTasks(caller);
        let filteredTasks = userTasks
            .map(taskId => tasksStorage.get(taskId))
            .filter((taskOpt): taskOpt is { Some: Task } => "Some" in taskOpt)
            .map(taskOpt => taskOpt.Some);
    
        if (req.query.status) {
            filteredTasks = filteredTasks.filter(task => task.status === req.query.status);
        }
        if (req.query.priority) {
            filteredTasks = filteredTasks.filter(task => task.priority === req.query.priority);
        }
        if (req.query.dueDate) {
            const dueDate = new Date(req.query.dueDate as string);
            filteredTasks = filteredTasks.filter(task => 
                "Some" in task.dueDate && task.dueDate.Some instanceof Date && task.dueDate.Some <= dueDate
            );
        }
    
        res.json(filteredTasks);
        } catch (error) {
            console.error("Error searching tasks:", error);
            res.status(500).send("An unexpected error occurred while searching tasks.");
        }
    });
    
    // Generate task statistics
    app.get("/tasks/stats", (req, res) => {
        try {
        const caller = ic.caller();
        const userTasks = getUserTasks(caller);
        const tasks = userTasks
            .map(taskId => tasksStorage.get(taskId))
            .filter((taskOpt): taskOpt is { Some: Task } => "Some" in taskOpt)
            .map(taskOpt => taskOpt.Some);
    
        const stats = {
            totalTasks: tasks.length,
            completedTasks: tasks.filter(task => task.status === TaskStatus.Completed).length,
            pendingTasks: tasks.filter(task => task.status === TaskStatus.Pending).length,
            inProgressTasks: tasks.filter(task => task.status === TaskStatus.InProgress).length,
            highPriorityTasks: tasks.filter(task => task.priority === TaskPriority.High).length,
            overdueTasks: tasks.filter(task => 
                "Some" in task.dueDate && 
                task.dueDate.Some instanceof Date && 
                task.dueDate.Some < getCurrentDate()
            ).length
        };
    
        res.json(stats);
        } catch (error) {
            console.error("Error generating task statistics:", error);
            res.status(500).send("An unexpected error occurred while generating task statistics.");
        }
    });

    return app.listen();
});

// Helper functions
function getCurrentDate(): Date {
    const timestamp = BigInt(ic.time());
    return new Date(Number(timestamp / BigInt(1_000_000)));
}

function addTaskToUser(userId: UserId, taskId: TaskId): boolean {
    const userTasksOpt = userTasksStorage.get(userId);
    const userTasks = "None" in userTasksOpt ? [] : userTasksOpt.Some;
    userTasks.push(taskId);
    const insertResult = userTasksStorage.insert(userId, userTasks);

    // Check if insertion was successful
    if (!insertResult) {
        return false;
    }
    return true;
}

function removeTaskFromUser(userId: UserId, taskId: TaskId): void {
    const userTasksOpt = userTasksStorage.get(userId);
    if ("Some" in userTasksOpt && Array.isArray(userTasksOpt.Some)) {
        const userTasks = userTasksOpt.Some.filter(id => id !== taskId);
        userTasksStorage.insert(userId, userTasks);
    }
}

// Update the getUserTasks function
function getUserTasks(userId: UserId): TaskId[] {
    const userTasksOpt = userTasksStorage.get(userId);
    return "Some" in userTasksOpt && Array.isArray(userTasksOpt.Some) ? userTasksOpt.Some : [];
}
