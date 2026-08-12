import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateMemorySchema,
  UpdateMemorySchema,
  type MemoryDto,
  type MemoryListResponse,
  type UpdateMemoryRequest,
} from '@mysoulmate/shared';
import type { z } from 'zod';
import { MemoriesService } from './memories.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('memories')
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<MemoryListResponse> {
    return this.memories.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateMemorySchema))
    body: z.output<typeof CreateMemorySchema>,
  ): Promise<MemoryDto> {
    return this.memories.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateMemorySchema)) body: UpdateMemoryRequest,
  ): Promise<MemoryDto> {
    return this.memories.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.memories.remove(user.id, id);
  }
}
