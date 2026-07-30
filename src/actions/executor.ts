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
      const id = await createReminder(db, intent.params.text, due);
      return {
        spoken: `Reminder set for ${due.toLocaleString()}: ${intent.params.text}`,
        display: `Reminder set: ${intent.params.text}`,
      };
    }

    case 'reminder.list': {
      const reminders = await listPendingReminders(db);
      if (reminders.length === 0) {
        return { spoken: 'You have no upcoming reminders.', display: 'No upcoming reminders.' };
      }
      const text = reminders.map((r) => `- ${r.text} at ${new Date(r.due).toLocaleString()}`).join('\n');
      return {
        spoken: `You have ${reminders.length} upcoming reminder${reminders.length === 1 ? '' : 's'}.`,
        display: text,
      };
    }

    case 'reminder.complete': {
      const reminderId = intent.params.id;
      if (!reminderId) {
        return { spoken: 'Please tell me which reminder to mark done.', display: 'Missing reminder id.' };
      }
      await markReminderNotified(db, reminderId);
      return { spoken: 'Reminder marked complete.', display: 'Reminder marked complete.' };
    }

    case 'todo.create': {
      const id = await createTodo(db, intent.params.text);
      return { spoken: `Added to-do: ${intent.params.text}`, display: `Added to-do: ${intent.params.text}` };
    }

    case 'todo.list': {
      const todos = await listTodos(db);
      if (todos.length === 0) {
        return { spoken: 'Your to-do list is empty.', display: 'No to-dos.' };
      }
      const text = todos.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.text}`).join('\n');
      return {
        spoken: `You have ${todos.length} to-do item${todos.length === 1 ? '' : 's'}.`,
        display: text,
      };
    }

    case 'todo.complete': {
      const todoId = intent.params.id;
      if (!todoId) {
        return { spoken: 'Please tell me which to-do to mark done.', display: 'Missing to-do id.' };
      }
      await completeTodo(db, todoId);
      return { spoken: 'To-do marked complete.', display: 'To-do marked complete.' };
    }

    case 'unknown':
    default: {
      return {
        spoken: "I'm not sure how to help with that yet. You can ask me to set reminders, manage to-dos, or chat.",
        display: 'Unknown intent.',
      };
    }
  }
}
