import type { Comment, ReviewContext, ReviewSubmission, ReviewSubmissionVerdict } from '../types';

/** Map the browser review document to the strict POST /api/submission body. */
export function buildSubmission(
  context: ReviewContext,
  comments: Comment[],
  verdict: ReviewSubmissionVerdict,
  summary: string,
): ReviewSubmission {
  return {
    action: 'submit',
    comparison_id: context.comparison_id,
    verdict,
    summary,
    comments: comments.map((comment) => {
      const quote = comment.quote;
      return {
        id: comment.id,
        body: comment.text,
        resolved: Boolean(comment.resolved),
        ...(quote ? {
          file: quote.file,
          line: quote.start,
          end_line: quote.end,
          side: quote.side,
          quote: quote.snippet,
        } : {}),
      };
    }),
  };
}

/** A cancel is the same endpoint with no comments and no verdict. */
export function buildCancel(context: ReviewContext): ReviewSubmission {
  return { action: 'cancel', comparison_id: context.comparison_id };
}
