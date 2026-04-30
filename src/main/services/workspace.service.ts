import { basename } from 'node:path'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Workspace } from '../../shared/types/entities.js'
import type { WorkspaceRequest } from '../../shared/contracts/ipc.js'
import { WorkspaceRepository } from '../../db/repositories/workspace-repo.js'
import { AuthService } from './auth.service.js'
import { electronRuntime } from '../utils/electron-runtime.js'

export class WorkspaceService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: WorkspaceRepository
  ) {}

  async list(payload: { actorToken?: string }): Promise<ServiceResponse<Workspace[]>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(actor.user.organizationId))
  }

  async create(payload: WorkspaceRequest): Promise<ServiceResponse<Workspace>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const rootPath = payload.rootPath?.trim()
    if (!rootPath) return errorResponse(ErrorCodes.Validation, 'Workspace folder required')
    const name = payload.name?.trim() || basename(rootPath) || 'Workspace'
    return okResponse(await this.repo.create({ organizationId: actor.user.organizationId, name, rootPath }))
  }

  async update(payload: WorkspaceRequest): Promise<ServiceResponse<Workspace>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload.id) return errorResponse(ErrorCodes.Validation, 'Workspace id required')
    const updated = await this.repo.update(actor.user.organizationId, payload.id, {
      name: payload.name?.trim() || undefined,
      rootPath: payload.rootPath?.trim() || undefined
    })
    if (!updated) return errorResponse(ErrorCodes.NotFound, 'Workspace not found')
    return okResponse(updated)
  }

  async remove(payload: WorkspaceRequest): Promise<ServiceResponse<{ ok: true }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload.id) return errorResponse(ErrorCodes.Validation, 'Workspace id required')
    await this.repo.remove(actor.user.organizationId, payload.id)
    return okResponse({ ok: true })
  }

  async pickFolder(payload: { actorToken?: string }): Promise<ServiceResponse<{ rootPath: string } | null>> {
    await this.auth.requireActor(payload?.actorToken)
    const dialog = electronRuntime.dialog
    if (!dialog) return errorResponse(ErrorCodes.Internal, 'Electron dialog runtime is unavailable')
    const result = await dialog.showOpenDialog({
      title: 'Select workspace folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return okResponse(null)
    return okResponse({ rootPath: result.filePaths[0] })
  }
}
