export class AppError extends Error {
  constructor(code, userMessage, details = null) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}
