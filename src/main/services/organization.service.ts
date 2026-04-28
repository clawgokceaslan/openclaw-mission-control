import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { AuthRepository } from '../../db/repositories/auth-repo.js'
import { OrganizationRepository } from '../../db/repositories/org-repo.js'
import { AuthService } from './auth.service.js'

export class OrganizationService {
  constructor(
    private readonly auth: AuthService,
    private readonly orgRepo: OrganizationRepository,
    private readonly authRepo: AuthRepository
  ) {}

  async me(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const org = await this.orgRepo.get(actor.user.organizationId)
    if (!org) return errorResponse(ErrorCodes.NotFound, 'Organization not found')
    return okResponse({ ...org, members: await this.orgRepo.members(org.id) })
  }

  async listMembers(payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const members = await this.orgRepo.members(actor.user.organizationId)
    return okResponse(members)
  }

  async createInvite(payload: { actorToken?: string; userId?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    if (!payload?.userId) return errorResponse(ErrorCodes.Validation, 'userId required')
    const user = await this.authRepo.findUserById(payload.userId)
    if (!user) return errorResponse(ErrorCodes.NotFound, 'User not found')
    if (user.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    return okResponse(await this.orgRepo.createInviteToken(actor.user.organizationId, payload.userId))
  }
}
