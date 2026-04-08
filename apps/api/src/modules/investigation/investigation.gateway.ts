import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: true } })
export class InvestigationGateway {
  @WebSocketServer() server: Server;

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
}
