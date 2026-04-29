import slackifyMarkdown from "slackify-markdown";

export function markdownToSlackMrkdwn(markdown: string): string {
  return slackifyMarkdown(markdown).trimEnd();
}
