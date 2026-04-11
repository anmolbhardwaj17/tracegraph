import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket, OnGatewayDisconnect } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: true } })
export class InvestigationGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(InvestigationGateway.name);
  @WebSocketServer() server: Server;

  handleDisconnect(client: Socket) {
    this.logger.debug(`socket ${client.id} disconnected`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() data: { investigationId: string }, @ConnectedSocket() client: Socket) {
    if (data?.investigationId) {
      client.join(`inv:${data.investigationId}`);
      return { ok: true };
    }
    return { ok: false };
  }

  emitEntityDiscovered(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('entity_discovered', payload);
  }

  emitEdgeCreated(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('edge_created', payload);
  }

  emitProgress(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('progress_update', payload);
  }

  emitComplete(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('expansion_complete', payload);
  }

  emitEntityMatched(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('entity_matched', payload);
  }

  emitResolutionProgress(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('resolution_progress', payload);
  }

  emitResolutionComplete(investigationId: string, payload: any) {
    this.server?.to(`inv:${investigationId}`).emit('resolution_complete', payload);
  }

  emitScoringStep(investigationId: string, payload: { step: string; detail?: string }) {
    this.server?.to(`inv:${investigationId}`).emit('scoring_step', payload);
  }

  emitStatusChanged(investigationId: string, status: string) {
    this.server?.to(`inv:${investigationId}`).emit('status_changed', { status });
  }
}
