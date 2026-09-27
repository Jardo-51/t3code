# Ticket links

Link a thread to the issue-tracker tickets it works on, so you can see which ticket a thread
belongs to, open the ticket from the thread, and find every thread for a ticket, settled ones
included.

A ticket link is the ticket's URL plus the ID shown for it. T3 Code never contacts the tracker, so
there is nothing to configure and no credentials to provide.

## Linking a ticket

- **Agents** link the ticket a thread is for with the `link_ticket` tool as soon as they know its
  URL, for example when you paste it or the branch refers to it.
- **Manually:** run **Link ticket to thread** from the command palette and paste the ticket's URL.
  Once a thread has tickets, the same command is called **Manage thread tickets**; it lists the
  thread's tickets and unlinks them.

The ticket ID is read from the URL for Jira, Linear, GitHub, GitLab, Forgejo, Gitea, Bitbucket and
Azure DevOps, and for any tracker whose URLs contain a `PROJ-123` style ID. For other trackers,
enter the ID yourself.

## Where tickets show

- Beside the branch under the composer. Click a ticket to open it; the **Open links in** setting
  decides where.
- On the thread's sidebar row. When a row has several tickets, the first one shows with a count.
  Settings → General → **Pull requests in sidebar** and **Tickets in sidebar** turn each badge on
  or off, for when the sidebar is too narrow for both.
- Searching the sidebar or the command palette for a ticket ID finds the threads linked to it.

Ticket links need a server from this fork. Web and desktop clients show them; the mobile app does
not yet.
