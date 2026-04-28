import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import { Job } from '../../shared/types/entities.js'
import { AuthService } from './auth.service.js'
import { JobRepository } from '../../db/repositories/job-repo.js'

export class JobService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: JobRepository
  ) {}

  get repository(): JobRepository {
    return this.repo
  }

  async list(payload: { actorToken?: string; status?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Job[]>> {
    await this.auth.requireActor(payload?.actorToken)
    return okResponse(await this.repo.list(payload?.status))
  }

  async metrics(_payload: { actorToken?: string }, _meta?: Record<string, unknown>): Promise<ServiceResponse<Record<string, number>>> {
    await this.auth.requireActor(_payload?.actorToken)
    const pending = (await this.repo.list('pending')).length
    const running = (await this.repo.list('running')).length
    const done = (await this.repo.list('done')).length
    const failed = (await this.repo.list('failed')).length
    const dead = (await this.repo.list('dead')).length
    return okResponse({ pending, running, done, failed, dead })
  }
}
