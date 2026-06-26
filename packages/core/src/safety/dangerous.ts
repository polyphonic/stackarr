export type DangerousConfirmation = {
  confirmDangerous?: boolean;
  reason?: string;
};

export type DeleteDataConfirmation = {
  deleteData?: boolean;
  confirmDeleteData?: boolean;
};

export class DangerousActionError extends Error {
  constructor(message = 'Dangerous action requires confirmDangerous: true and a reason.') {
    super(message);
    this.name = 'DangerousActionError';
  }
}

export function requireDangerousConfirmation(input: DangerousConfirmation) {
  if (input.confirmDangerous !== true || !input.reason?.trim()) {
    throw new DangerousActionError();
  }
}

export function requireDeleteDataConfirmation(input: DeleteDataConfirmation) {
  if (input.deleteData && input.confirmDeleteData !== true) {
    throw new DangerousActionError('Deleting downloaded data requires confirmDeleteData: true.');
  }
}
