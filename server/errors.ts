/** A refusal the client can show: `code` selects the translated message, `message` is the English fallback. */
export class Failure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
