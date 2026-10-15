// Problem Details (RFC 9457) con `code` estable y textos es/en (Accept-Language).
const M = {
  VALIDATION_FAILED: [400, ['Datos inválidos', 'Uno o más campos no cumplen las reglas.'], ['Invalid data', 'One or more fields break the rules.']],
  UNAUTHORIZED: [401, ['No autenticado', 'El token de acceso no es válido o expiró. Vuelve a iniciar sesión.'], ['Not authenticated', 'The access token is invalid or expired. Please sign in again.']],
  FORBIDDEN: [403, ['Acceso denegado', 'No tienes permiso para realizar esta acción.'], ['Access denied', 'You are not allowed to perform this action.']],
  NOT_FOUND: [404, ['Recurso no encontrado', 'El recurso no existe o no es visible para ti.'], ['Resource not found', 'The resource does not exist or is not visible to you.']],
  METHOD_NOT_ALLOWED: [405, ['Método no permitido', 'El método HTTP no está permitido en esta ruta.'], ['Method not allowed', 'This HTTP method is not allowed here.']],
  CONFLICT: [409, ['Conflicto', 'La petición entra en conflicto con el estado actual del recurso.'], ['Conflict', 'The request conflicts with the current resource state.']],
  UNPROCESSABLE_ENTITY: [422, ['Regla de negocio violada', 'La petición es válida pero no se puede procesar.'], ['Business rule violated', 'The request is valid but cannot be processed.']],
  RATE_LIMITED: [429, ['Demasiadas peticiones', 'Has hecho demasiadas peticiones. Intenta de nuevo en unos segundos.'], ['Too many requests', 'You sent too many requests. Try again in a few seconds.']],
  INTERNAL_ERROR: [500, ['Error interno', 'Ocurrió un error inesperado.'], ['Internal error', 'An unexpected error occurred.']],
  SERVICE_UNAVAILABLE: [503, ['Servicio no disponible', 'El servicio no está disponible en este momento.'], ['Service unavailable', 'The service is not available right now.']],
  FEATURE_DISABLED: [503, ['Función deshabilitada', 'Esta función pertenece a la fase 2 y está deshabilitada en el mock.'], ['Feature disabled', 'This feature belongs to phase 2 and is disabled in the mock.']],
  IDEMPOTENCY_KEY_REUSED: [422, ['Clave de idempotencia reutilizada', 'La Idempotency-Key ya se usó con una petición diferente. Genera una clave nueva.'], ['Idempotency key reused', 'The Idempotency-Key was already used with a different request. Generate a new one.']],
  IDEMPOTENCY_IN_PROGRESS: [409, ['Petición en curso', 'Ya se está procesando una petición con esta Idempotency-Key. Reintenta en unos segundos.'], ['Request in progress', 'A request with this Idempotency-Key is still being processed. Retry shortly.']],
  EMAIL_ALREADY_REGISTERED: [409, ['Correo ya registrado', 'Ya existe una cuenta con ese correo.'], ['Email already registered', 'An account with that email already exists.']],
  EMAIL_DOMAIN_NOT_ALLOWED: [422, ['Dominio no permitido', 'El correo no pertenece a un dominio institucional de la universidad elegida.'], ['Domain not allowed', 'The email is not from an institutional domain of the chosen university.']],
  EMAIL_ALREADY_VERIFIED: [409, ['Correo ya verificado', 'Este correo ya fue verificado.'], ['Email already verified', 'This email was already verified.']],
  EMAIL_NOT_VERIFIED: [403, ['Correo sin verificar', 'Debes verificar tu correo antes de iniciar sesión.'], ['Email not verified', 'You must verify your email before signing in.']],
  INVALID_VERIFICATION_CODE: [422, ['Código inválido', 'El código de verificación es incorrecto o expiró.'], ['Invalid code', 'The verification code is wrong or expired.']],
  VERIFICATION_ATTEMPTS_EXCEEDED: [422, ['Demasiados intentos', 'Superaste los intentos de verificación. Solicita un código nuevo.'], ['Too many attempts', 'You exceeded the verification attempts. Request a new code.']],
  INVALID_CREDENTIALS: [401, ['Credenciales inválidas', 'El correo o la contraseña son incorrectos.'], ['Invalid credentials', 'The email or password is wrong.']],
  ACCOUNT_SUSPENDED: [403, ['Cuenta suspendida', 'Tu cuenta está suspendida. Contacta a un moderador.'], ['Account suspended', 'Your account is suspended. Contact a moderator.']],
  INVALID_REFRESH_TOKEN: [401, ['Sesión inválida', 'El token de refresco es inválido o expiró.'], ['Invalid session', 'The refresh token is invalid or expired.']],
  REFRESH_TOKEN_REUSED: [401, ['Token reutilizado', 'Se detectó la reutilización de un token de refresco. Inicia sesión de nuevo.'], ['Token reused', 'Refresh token reuse detected. Please sign in again.']],
  HANDOFF_CODE_INVALID: [401, ['Código de traspaso inválido', 'El código de traspaso es inválido, expiró o ya se usó.'], ['Invalid handoff code', 'The handoff code is invalid, expired or already used.']],
  INVALID_CLIENT: [401, ['Cliente inválido', 'Credenciales de cliente inválidas.'], ['Invalid client', 'Invalid client credentials.']],
  UNIVERSITY_DOMAIN_TAKEN: [409, ['Dominio en uso', 'Ese dominio ya pertenece a otra universidad.'], ['Domain taken', 'That domain already belongs to another university.']],
  LAST_ADMIN: [409, ['Último administrador', 'No se puede quitar el rol al último administrador.'], ['Last admin', 'The last administrator cannot lose the role.']],
  CANNOT_FOLLOW_SELF: [422, ['No puedes seguirte', 'No puedes seguirte a ti mismo.'], ['Cannot follow yourself', 'You cannot follow yourself.']],
  CANNOT_REPORT_OWN_CONTENT: [422, ['Contenido propio', 'No puedes denunciar tu propio contenido.'], ['Own content', 'You cannot report your own content.']],
  ALREADY_REPORTED: [409, ['Ya denunciado', 'Ya denunciaste este contenido.'], ['Already reported', 'You already reported this content.']],
  GROUP_MEMBERSHIP_REQUIRED: [403, ['Se requiere ser miembro', 'Debes ser miembro activo del grupo.'], ['Membership required', 'You must be an active member of the group.']],
  MEMBERSHIP_NOT_PENDING: [409, ['Solicitud no pendiente', 'La solicitud de ingreso ya no está pendiente.'], ['Request not pending', 'The join request is no longer pending.']],
  OWNER_CANNOT_LEAVE: [409, ['El propietario no puede salir', 'El propietario no puede abandonar su grupo.'], ['Owner cannot leave', 'The owner cannot leave the group.']],
  GROUP_NAME_TAKEN: [409, ['Nombre en uso', 'Ya existe un grupo con ese nombre.'], ['Name taken', 'A group with that name already exists.']],
  POST_NOT_PUBLISHED: [409, ['Publicación no disponible', 'La publicación no está publicada.'], ['Post not available', 'The post is not published.']],
  MEDIA_NOT_FOUND: [422, ['Medio no encontrado', 'Alguno de los medios no existe o no es tuyo.'], ['Media not found', 'One of the media items does not exist or is not yours.']],
  MEDIA_NOT_APPROVED: [422, ['Medio rechazado', 'Alguno de los medios fue rechazado por moderación.'], ['Media rejected', 'One of the media items was rejected by moderation.']],
  MEDIA_NOT_FLAGGED: [409, ['Medio no marcado', 'El medio no está pendiente de revisión.'], ['Media not flagged', 'The media item is not pending review.']],
  MEDIA_TOO_LARGE: [422, ['Archivo demasiado grande', 'El archivo supera el tamaño permitido.'], ['File too large', 'The file exceeds the allowed size.']],
  VIDEO_TOO_LONG: [422, ['Video demasiado largo', 'El video no puede durar más de 60 segundos.'], ['Video too long', 'Videos cannot exceed 60 seconds.']],
  UNSUPPORTED_MEDIA_TYPE: [422, ['Tipo no soportado', 'Este uso solo admite imágenes.'], ['Unsupported type', 'This purpose only accepts images.']],
  UPLOAD_MISSING: [422, ['Archivo no subido', 'Aún no se recibió el archivo en la URL prefirmada (haz el PUT primero).'], ['Upload missing', 'No file was received at the presigned URL yet (do the PUT first).']],
  STARTS_AT_IN_PAST: [422, ['Fecha en el pasado', 'La fecha de inicio debe ser futura.'], ['Date in the past', 'The start date must be in the future.']],
  INVALID_EVENT_STATUS: [409, ['Estado de evento inválido', 'El evento no está en un estado que permita esta acción.'], ['Invalid event status', 'The event is not in a state that allows this action.']],
  EVENT_NOT_OPEN: [422, ['Evento no abierto', 'El evento no está publicado o ya empezó.'], ['Event not open', 'The event is not published or already started.']],
  EVENT_FULL: [409, ['Evento lleno', 'No quedan cupos disponibles.'], ['Event full', 'No seats left.']],
  ALREADY_REGISTERED: [409, ['Ya inscrito', 'Ya tienes una inscripción activa en este evento.'], ['Already registered', 'You already have an active registration for this event.']],
  INVALID_REGISTRATION_STATUS: [409, ['Inscripción no cancelable', 'La inscripción no está en un estado que permita cancelarla.'], ['Registration not cancellable', 'The registration state does not allow cancelling.']],
  CANCELLATION_WINDOW_CLOSED: [409, ['Ventana cerrada', 'Ya no se puede cancelar: el evento empieza en menos de una hora.'], ['Window closed', 'Cancelling is no longer possible: the event starts in under an hour.']],
  SAGA_NOT_RETRYABLE: [409, ['SAGA no reintentable', 'Solo se pueden reintentar SAGAs en estado FAILED.'], ['Saga not retryable', 'Only FAILED sagas can be retried.']],
  TOPUP_NOT_PENDING: [409, ['Recarga no pendiente', 'La recarga ya no está pendiente.'], ['Top-up not pending', 'The top-up is no longer pending.']],
  INVALID_SIGNATURE: [401, ['Firma inválida', 'La firma del webhook no es válida.'], ['Invalid signature', 'The webhook signature is invalid.']],
  INVALID_QR_SIGNATURE: [422, ['QR inválido', 'La firma del código QR no es válida.'], ['Invalid QR', 'The QR code signature is not valid.']],
  TICKET_EVENT_MISMATCH: [422, ['Evento distinto', 'La entrada pertenece a otro evento.'], ['Different event', 'The ticket belongs to another event.']],
  TICKET_ALREADY_USED: [409, ['Entrada ya usada', 'Esta entrada ya fue validada.'], ['Ticket already used', 'This ticket was already validated.']],
  TICKET_VOIDED: [409, ['Entrada anulada', 'Esta entrada fue anulada.'], ['Ticket voided', 'This ticket was voided.']],
  NOT_EVENT_ORGANIZER: [403, ['No eres el organizador', 'Solo el organizador del evento (o un administrador) puede validar entradas.'], ['Not the organizer', 'Only the event organizer (or an admin) can validate tickets.']],
  AMOUNT_MISMATCH: [422, ['Monto distinto', 'El monto del pago no coincide con la recarga.'], ['Amount mismatch', 'The payment amount does not match the top-up.']],
  INVALID_CURSOR: [400, ['Cursor inválido', 'El cursor de paginación no es válido.'], ['Invalid cursor', 'The pagination cursor is not valid.']],
};

export const pickLang = (header) => {
  const first = String(header ?? '').split(',')[0].trim().toLowerCase();
  return first.startsWith('en') ? 'en' : 'es';
};

export class ApiError extends Error {
  constructor(code, { status, detail, errors, headers, extra } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.errors = errors;
    this.headers = headers;
    this.extra = extra;
  }
}
export const fail = (code, opts) => new ApiError(code, opts);

export function toProblem(err, { lang, instance, traceId }) {
  const entry = M[err.code];
  const status = err.status ?? entry?.[0] ?? 400;
  const texts = entry ? entry[lang === 'en' ? 2 : 1] : lang === 'en' ? ['Error', err.code] : ['Error', err.code];
  const body = {
    type: `https://api.bandadau.com/problems/${err.code.toLowerCase().replaceAll('_', '-')}`,
    title: texts[0],
    status,
    detail: err.detail ?? texts[1],
    instance,
    code: err.code,
    traceId,
    ...(err.errors ? { errors: err.errors } : {}),
    ...(err.extra ?? {}),
  };
  return { status, body };
}

const FIELD_MSG = {
  REQUIRED: ['Campo obligatorio.', 'Required field.'],
  TOO_LONG: ['Supera la longitud máxima.', 'Exceeds the maximum length.'],
  TOO_SHORT: ['Es demasiado corto.', 'Too short.'],
  INVALID_FORMAT: ['Formato inválido.', 'Invalid format.'],
  INVALID_VALUE: ['Valor no permitido.', 'Value not allowed.'],
  INVALID_TYPE: ['Tipo de dato inválido.', 'Invalid data type.'],
  OUT_OF_RANGE: ['Valor fuera de rango.', 'Value out of range.'],
  UNKNOWN_FIELD: ['Campo desconocido.', 'Unknown field.'],
  INVALID: ['Valor inválido.', 'Invalid value.'],
};
export const fieldError = (field, code, lang, pointer) => ({
  field,
  pointer: pointer ?? '/' + field.replaceAll('.', '/'),
  code,
  message: FIELD_MSG[code]?.[lang === 'en' ? 1 : 0] ?? code,
});

const KW = { required: 'REQUIRED', maxLength: 'TOO_LONG', maxItems: 'TOO_LONG', minLength: 'TOO_SHORT', minItems: 'TOO_SHORT', pattern: 'INVALID_FORMAT', format: 'INVALID_FORMAT', enum: 'INVALID_VALUE', const: 'INVALID_VALUE', type: 'INVALID_TYPE', minimum: 'OUT_OF_RANGE', maximum: 'OUT_OF_RANGE', exclusiveMinimum: 'OUT_OF_RANGE', exclusiveMaximum: 'OUT_OF_RANGE', additionalProperties: 'UNKNOWN_FIELD' };
export function ajvErrorsToFields(errors, lang) {
  const out = [];
  for (const e of errors ?? []) {
    if (['if', 'then', 'else', 'oneOf', 'anyOf', 'allOf'].includes(e.keyword)) continue;
    let pointer = e.instancePath;
    if (e.keyword === 'required') pointer += `/${e.params.missingProperty}`;
    if (e.keyword === 'additionalProperties') pointer += `/${e.params.additionalProperty}`;
    const field = pointer.replace(/^\//, '').replace(/\/(\d+)/g, '[$1]').replaceAll('/', '.') || '(body)';
    const code = KW[e.keyword] ?? 'INVALID';
    if (out.some((x) => x.pointer === pointer && x.code === code)) continue;
    out.push(fieldError(field, code, lang, pointer || '/'));
  }
  return out;
}
