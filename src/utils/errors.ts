export class AppError extends Error {
  public statusCode;
  protected data: any;

  constructor(
    msg: string = "Une erreur est survenu",
    statusCode: number = 500,
    data: any = {},
  ) {
    super(msg);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.data = data;
  }
}

export class NotFoundError extends AppError {
  public statusCode: number = 404;

  constructor(message: string = "Resource not found") {
    super(message, 404);
  }
}

// Not connected
export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized access") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class BadRequestError extends AppError {
  public code;
  constructor(message: string = "Bad Request", code?: unknown) {
    super(message, 400);
    this.name = "BadRequestError";
    this.code = code;
  }
}

// Server understand but can response for a raison
export class UnprocessableEntity extends AppError {
  public code;
  constructor(message: string = "Unprocessable request", code?: unknown) {
    super(message, 422);
    this.name = "Unprocessable Request";
    this.code = code;
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict Request") {
    super(message, 409);
    this.name = "ConflictError";
  }
}
export class ForbiddenError extends AppError {
  constructor(message: string = "Accès refusé") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Données invalides") {
    super(message, 400);
    this.name = "ValidationError";
  }
}
