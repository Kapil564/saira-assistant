import { db } from '../db';
import {
  completeTodo,
  createReminder,
  createTodo,
  listPendingReminders,
  listTodos,
  markReminderNotified,
} from '../db/actions';
import type { AssistantResponse, IntentResult } from '../shared/types';

export async function executeIntent(intent: IntentResult): Promise<AssistantResponse> {
  switch (intent.intent) {
    case 'chat.respond': {
      return { spoken: intent.params.message, display: intent.params.message };
    }

    case 'reminder.create': {
      const due = new Date(intent.params.due);
      await createReminder(db, intent.params.text, due);
      return {
        spoken: '',
        display: `Reminder set: ${intent.params.text} at ${due.toLocaleString()}`,
      };
    }

    case 'reminder.list': {
      const reminders = await listPendingReminders(db);
      if (reminders.length === 0) {
        return { spoken: '', display: 'No upcoming reminders.' };
      }
      const text = reminders.map((r) => `- ${r.text} at ${new Date(r.due).toLocaleString()}`).join('\n');
      return {
        spoken: '',
        display: text,
      };
    }

    case 'reminder.complete': {
      const reminderId = intent.params.id;
      if (!reminderId) {
        return { spoken: '', display: 'Missing reminder id.' };
      }
      await markReminderNotified(db, reminderId);
      return { spoken: '', display: 'Reminder marked complete.' };
    }

    case 'todo.create': {
      await createTodo(db, intent.params.text);
      return { spoken: '', display: `Added to-do: ${intent.params.text}` };
    }

    case 'todo.list': {
      const todos = await listTodos(db);
      if (todos.length === 0) {
        return { spoken: '', display: 'No to-dos.' };
      }
      const text = todos.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.text}`).join('\n');
      return {
        spoken: '',
        display: text,
      };
    }

    case 'todo.complete': {
      const todoId = intent.params.id;
      if (!todoId) {
        return { spoken: '', display: 'Missing to-do id.' };
      }
      await completeTodo(db, todoId);
      return { spoken: '', display: 'To-do marked complete.' };
    }

    case 'unknown':
    default: {
      return {
        spoken: "I'm not sure how to help with that yet.",
        display: 'Unknown intent.',
      };
    }
  }
}
