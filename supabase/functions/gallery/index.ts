/**
 * /gallery — router only. rule2.txt §7.
 *
 * Team galleries backed by Cloudinary: team-side file management, the
 * storage screen (shared by the team and the super admin), the public
 * gallery, and the two scheduled jobs.
 */

import { createRouter } from '../_shared/router.ts'
import { createAlbum, deleteAlbum, listAlbums, updateAlbum } from './handlers/albums.ts'
import {
  compressMedia, confirmUpload, downloadMedia, emptyTrash, listMedia, moveMedia,
  purgeMedia, restoreMedia, signUpload, trashMedia, updateMedia,
} from './handlers/media.ts'
import {
  addAccount, getStorage, listAllStorage, refreshAll, refreshOne, removeAccount,
  reorderAccounts, updateAccount, updateSettings,
} from './handlers/storage.ts'
import { favourite, publicDownload, publicGallery, publicMedia } from './handlers/public.ts'
import { cronPurge, cronUsage } from './handlers/cron.ts'

Deno.serve(createRouter('gallery', {
  GET: {
    'albums': listAlbums,
    'media': listMedia,
    'storage': listAllStorage,
    'storage/:orgId': getStorage,
    'public/:slug': publicGallery,
    'public/:slug/media': publicMedia,
  },
  POST: {
    'albums': createAlbum,
    'uploads/sign': signUpload,
    'uploads/confirm': confirmUpload,
    'media/move': moveMedia,
    'media/trash': trashMedia,
    'media/restore': restoreMedia,
    'media/purge': purgeMedia,
    'media/empty-trash': emptyTrash,
    'media/compress': compressMedia,
    'media/download': downloadMedia,
    'storage/:orgId/accounts': addAccount,
    'storage/:orgId/accounts/:id/refresh': refreshOne,
    'storage/:orgId/refresh': refreshAll,
    'storage/:orgId/reorder': reorderAccounts,
    'public/:slug/favourite': favourite,
    'public/:slug/download': publicDownload,
    'cron/usage': cronUsage,
    'cron/purge': cronPurge,
  },
  PATCH: {
    'albums/:id': updateAlbum,
    'media/:id': updateMedia,
    'storage/:orgId/accounts/:id': updateAccount,
    'storage/:orgId/settings': updateSettings,
  },
  DELETE: {
    'albums/:id': deleteAlbum,
    'storage/:orgId/accounts/:id': removeAccount,
  },
}))
