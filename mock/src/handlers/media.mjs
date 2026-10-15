import { fail } from '../errors.mjs';
import { setMediaStatus, toMediaAsset, isStaff } from '../domain.mjs';
import { BASE_URL } from '../config.mjs';
import { db, later } from '../state.mjs';
import { now, res, uuid } from '../util.mjs';

export const mediaHandlers = {
  async createUpload(c) {
    const { kind, purpose = 'POST', mimeType, sizeBytes, durationSeconds, fileName } = c.body;
    if (kind === 'IMAGE' && mimeType.startsWith('video/')) throw fail('UNSUPPORTED_MEDIA_TYPE', { detail: 'kind=IMAGE no coincide con mimeType de video.' });
    if (kind === 'VIDEO' && mimeType.startsWith('image/')) throw fail('UNSUPPORTED_MEDIA_TYPE', { detail: 'kind=VIDEO no coincide con mimeType de imagen.' });
    if (purpose !== 'POST' && kind === 'VIDEO') throw fail('UNSUPPORTED_MEDIA_TYPE');
    const id = uuid();
    db.media.set(id, {
      id, ownerId: c.user.id, kind, purpose, mimeType, sizeBytes, durationSeconds: durationSeconds ?? null, status: 'PENDING_UPLOAD', path: `/mock-assets/uploads/${id}`,
      tags: [], ocrText: null, createdAt: now(), updatedAt: now(), moderation: null, fileName: fileName ?? '',
    });
    return res(201, { mediaId: id, uploadUrl: `${BASE_URL}/mock-assets/uploads/${id}`, uploadMethod: 'PUT', uploadHeaders: { 'Content-Type': mimeType }, expiresIn: 900 });
  },

  async completeUpload(c) {
    const m = db.media.get(c.params.mediaId);
    if (!m) throw c.notFound('Medio');
    if (m.ownerId !== c.user.id) throw fail('FORBIDDEN');
    if (m.status !== 'PENDING_UPLOAD') return res(202, toMediaAsset(m));
    if (!db.uploads.has(m.id)) throw fail('UPLOAD_MISSING');
    m.status = 'PROCESSING';
    m.updatedAt = now();
    later(800, () => {
      const manual = (process.env.MOCK_MODERATION_MODE ?? 'allow-all') === 'manual';
      if (manual || /flag/i.test(m.fileName ?? '')) {
        m.moderation = { model: 'mock-nsfw', modelVersion: '0.0.1-mock', labels: ['nsfw'], scores: { nsfw: 0.77, safe: 0.23 }, decision: 'REVIEW', frameIndex: null, createdAt: now(), finalDecision: null };
        m.tags = ['nsfw'];
        setMediaStatus(m, 'FLAGGED');
      } else {
        setMediaStatus(m, 'APPROVED');
      }
    });
    return res(202, toMediaAsset(m));
  },

  async getMedia(c) {
    const m = db.media.get(c.params.mediaId);
    if (!m || (m.ownerId !== c.user.id && !isStaff(c.user) && m.status !== 'APPROVED')) throw c.notFound('Medio');
    return toMediaAsset(m);
  },
};
