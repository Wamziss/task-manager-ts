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
        const caller = ic.caller();
        const task: Task = {
            id: uuidv4(),
            title: req.body.title,
            description: req.body.description,
            status: TaskStatus.Pending,
            priority: req.body.priority || TaskPriority.Medium,
            assignee: req.body.assignee ? { Some: Principal.fromText(req.body.assignee) } : { None: null },
            dueDate: req.body.dueDate ? { Some: new Date(req.body.dueDate) } : { None: null },
            createdAt: getCurrentDate(),
            updatedAt: getCurrentDate(),
            comments: []
        };
        tasksStorage.insert(task.id, task);
        addTaskToUser(caller, task.id);
        res.json(task);
    });

    // Get all tasks for the caller
    app.get("/tasks", (req, res) => {
        const caller = ic.caller();
        const userTasks = getUserTasks(caller);
        const tasks = userTasks.map(taskId => tasksStorage.get(taskId).Some);
        res.json(tasks);
    });

    // Get a specific task
    app.get("/tasks/:id", (req, res) => {
        const taskId = req.params.id;
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
            res.status(404).send(`Task with id=${taskId} not found`);
        } else {
            res.json(taskOpt.Some);
        }
    });

    // Update a task
    app.put("/tasks/:id", (req, res) => {
        const taskId = req.params.id;
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
            res.status(404).send(`Task with id=${taskId} not found`);
        } else {
            const task = taskOpt.Some;
            const updatedTask: Task = {
                ...task,
                title: req.body.title || task.title,
                description: req.body.description || task.description,
                status: req.body.status || task.status,
                priority: req.body.priority || task.priority,
                assignee: req.body.assignee ? { Some: Principal.fromText(req.body.assignee) } : task.assignee,
                dueDate: req.body.dueDate ? { Some: new Date(req.body.dueDate) } : task.dueDate,
                updatedAt: getCurrentDate()
            };
            tasksStorage.insert(taskId, updatedTask);
            res.json(updatedTask);
        }
    });

    // Delete a task
    app.delete("/tasks/:id", (req, res) => {
        const taskId = req.params.id;
        const deletedTask = tasksStorage.remove(taskId);
        if ("None" in deletedTask) {
            res.status(404).send(`Task with id=${taskId} not found`);
        } else {
            removeTaskFromUser(ic.caller(), taskId);
            res.json(deletedTask.Some);
        }
    });

    // Add a comment to a task
    app.post("/tasks/:id/comments", (req, res) => {
        const taskId = req.params.id;
        const taskOpt = tasksStorage.get(taskId);
        if ("None" in taskOpt) {
            res.status(404).send(`Task with id=${taskId} not found`);
        } else {
            const task = taskOpt.Some;
            const comment: Comment = {
                id: uuidv4(),
                content: req.body.content,
                author: ic.caller(),
                createdAt: getCurrentDate()
            };
            task.comments.push(comment);
            task.updatedAt = getCurrentDate();
            tasksStorage.insert(taskId, task);
            res.json(comment);
        }
    });


    app.get("/tasks/search", (req: any, res: any) => {
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
    });
    
    // Generate task statistics
    app.get("/tasks/stats", (req: any, res: any) => {
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
    });

    return app.listen();
});

// Helper functions
function getCurrentDate(): Date {
    const timestamp = BigInt(ic.time());
    return new Date(Number(timestamp / BigInt(1_000_000)));
}

function addTaskToUser(userId: UserId, taskId: TaskId): void {
    const userTasksOpt = userTasksStorage.get(userId);
    const userTasks = "None" in userTasksOpt ? [] : userTasksOpt.Some;
    userTasks.push(taskId);
    userTasksStorage.insert(userId, userTasks);
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