// frontend/js/socket-client.js
class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.tiendaId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.callbacks = new Map();
    this.pingInterval = null;
    
    this.init();
  }

  init() {
    try {
      // Inicializar Socket.IO con configuración
      this.socket = io({
        transports: ['websocket', 'polling'],
        timeout: 20000,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        maxReconnectionAttempts: this.maxReconnectAttempts
      });

      this.setupEventListeners();
      console.log('Socket.IO inicializado');
    } catch (error) {
      console.error('Error inicializando Socket.IO:', error);
      this.handleConnectionError(error);
    }
  }

  setupEventListeners() {
    // Evento de conexión exitosa
    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('Conectado al servidor Socket.IO:', this.socket.id);
      
      this.showConnectionStatus('Conectado', 'success');
      
      // Reunirse a la tienda si existe
      if (this.tiendaId) {
        this.joinTienda(this.tiendaId);
      }
      
      // Iniciar ping periódico
      this.startPing();
      
      // Ejecutar callbacks de conexión
      this.executeCallbacks('connect');
    });

    // Evento de desconexión
    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('Desconectado del servidor:', reason);
      
      this.showConnectionStatus('Desconectado', 'error');
      this.stopPing();
      
      // Ejecutar callbacks de desconexión
      this.executeCallbacks('disconnect', { reason });
    });

    // Evento de error de conexión
    this.socket.on('connect_error', (error) => {
      console.error('Error de conexión:', error);
      this.handleConnectionError(error);
    });

    // Evento de reconexión
    this.socket.on('reconnect', (attemptNumber) => {
      console.log('Reconectado después de', attemptNumber, 'intentos');
      this.showConnectionStatus('Reconectado', 'success');
    });

    // Evento de intento de reconexión
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('Intento de reconexión:', attemptNumber);
      this.showConnectionStatus('Reconectando...', 'warning');
    });

    // Eventos específicos de la aplicación
    this.setupAppEvents();
  }

  setupAppEvents() {
    // Nueva orden recibida (para administradores)
    this.socket.on('nueva-orden', (data) => {
      console.log('Nueva orden recibida:', data);
      this.handleNewOrder(data);
      this.executeCallbacks('nueva-orden', data);
    });

    // Estado de orden actualizado
    this.socket.on('orden-actualizada', (data) => {
      console.log('Orden actualizada:', data);
      this.handleOrderUpdate(data);
      this.executeCallbacks('orden-actualizada', data);
    });

    // Estado de orden actualizado (evento alternativo)
    this.socket.on('orden-status-updated', (data) => {
      console.log('Estado de orden actualizado:', data);
      this.handleOrderStatusUpdate(data);
      this.executeCallbacks('orden-status-updated', data);
    });

    // Notificación personalizada
    this.socket.on('notificacion-personalizada', (data) => {
      console.log('Notificación personalizada:', data);
      this.handleCustomNotification(data);
      this.executeCallbacks('notificacion-personalizada', data);
    });

    // Estado de conexión
    this.socket.on('connection-status', (data) => {
      console.log('Estado de conexión:', data);
      this.executeCallbacks('connection-status', data);
    });

    // Pong response
    this.socket.on('pong', (data) => {
      console.log('Pong recibido:', data.timestamp);
    });
  }

  // Unirse a una tienda específica
  joinTienda(tiendaId, isAdmin = false) {
    if (!this.socket || !this.isConnected) {
      console.warn('Socket no conectado, guardando tiendaId para cuando se conecte');
      this.tiendaId = tiendaId;
      return;
    }

    this.tiendaId = tiendaId;
    
    // Unirse a la sala de la tienda
    this.socket.emit('join-tienda', tiendaId);
    
    // Si es admin, también unirse a la sala de admin
    if (isAdmin) {
      this.socket.emit('join-tienda-admin', tiendaId);
    }
    
    console.log(`Unido a tienda ${tiendaId} ${isAdmin ? '(como admin)' : ''}`);
  }

  // Salir de una tienda
  leaveTienda(tiendaId = null) {
    const targetId = tiendaId || this.tiendaId;
    
    if (this.socket && targetId) {
      this.socket.emit('leave-tienda', targetId);
      console.log(`Salió de tienda ${targetId}`);
    }
    
    if (!tiendaId) {
      this.tiendaId = null;
    }
  }

  // Actualizar estado de orden
  updateOrderStatus(ordenId, nuevoEstado, tiendaId, numeroOrden) {
    if (!this.socket || !this.isConnected) {
      console.warn('Socket no conectado, no se puede actualizar estado');
      return false;
    }

    this.socket.emit('update-orden-status', {
      tiendaId: tiendaId || this.tiendaId,
      ordenId,
      nuevoEstado,
      numeroOrden
    });

    return true;
  }

  // Notificar nueva orden
  notifyNewOrder(tiendaId, orden) {
    if (!this.socket || !this.isConnected) {
      console.warn('Socket no conectado, no se puede notificar nueva orden');
      return false;
    }

    this.socket.emit('nueva-orden', {
      tiendaId: tiendaId || this.tiendaId,
      orden
    });

    return true;
  }

  // Ping periódico para mantener conexión
  startPing() {
    this.stopPing(); // Limpiar ping anterior
    
    this.pingInterval = setInterval(() => {
      if (this.socket && this.isConnected) {
        this.socket.emit('ping');
      }
    }, 30000); // Ping cada 30 segundos
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Registrar callbacks para eventos
  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event).push(callback);
  }

  // Desregistrar callbacks
  off(event, callback = null) {
    if (!this.callbacks.has(event)) return;
    
    if (callback) {
      const callbacks = this.callbacks.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    } else {
      this.callbacks.delete(event);
    }
  }

  // Ejecutar callbacks registrados
  executeCallbacks(event, data = null) {
    if (!this.callbacks.has(event)) return;
    
    const callbacks = this.callbacks.get(event);
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error ejecutando callback para evento ${event}:`, error);
      }
    });
  }

  // Manejar nueva orden
  handleNewOrder(data) {
    // Mostrar notificación
    this.showNotification({
      title: '¡Nueva Orden!',
      message: `Orden ${data.orden.numero_orden} de ${data.orden.cliente_nombre}`,
      type: 'success',
      duration: 0, // No auto-hide
      actions: [
        {
          text: 'Ver Orden',
          action: () => this.openOrderDetail(data.orden.id)
        },
        {
          text: 'Cerrar',
          action: () => this.closeNotification()
        }
      ]
    });

    // Reproducir sonido de notificación
    this.playNotificationSound();

    // Actualizar contador de órdenes pendientes
    this.updatePendingOrdersCount();
  }

  // Manejar actualización de orden
  handleOrderUpdate(data) {
    const statusMessages = {
      'confirmada': 'Tu orden ha sido confirmada',
      'preparando': 'Tu orden se está preparando',
      'enviada': 'Tu orden está en camino',
      'entregada': 'Tu orden ha sido entregada',
      'cancelada': 'Tu orden ha sido cancelada'
    };

    this.showNotification({
      title: 'Orden Actualizada',
      message: `${data.numeroOrden}: ${statusMessages[data.nuevoEstado] || 'Estado actualizado'}`,
      type: data.nuevoEstado === 'cancelada' ? 'error' : 'info',
      duration: 5000
    });

    // Actualizar UI si estamos en la página de órdenes
    this.updateOrderInUI(data);
  }

  // Manejar actualización de estado
  handleOrderStatusUpdate(data) {
    this.handleOrderUpdate(data); // Usar el mismo manejador
  }

  // Manejar notificación personalizada
  handleCustomNotification(data) {
    this.showNotification({
      title: data.tipo === 'info' ? 'Información' : 'Notificación',
      message: data.mensaje,
      type: data.tipo || 'info',
      duration: 5000
    });
  }

  // Mostrar estado de conexión
  showConnectionStatus(status, type) {
    const statusElement = document.getElementById('connection-status');
    if (!statusElement) return;

    statusElement.className = `connection-status ${type}`;
    statusElement.textContent = status;
    statusElement.style.display = 'block';

    if (type === 'success') {
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }

  // Mostrar notificación
  showNotification(options) {
    const {
      title,
      message,
      type = 'info',
      duration = 5000,
      actions = []
    } = options;

    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-header">
        <strong>${title}</strong>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="notification-body">
        ${message}
      </div>
      ${actions.length > 0 ? `
        <div class="notification-actions">
          ${actions.map(action => `
            <button class="notification-action" onclick="(${action.action})()">${action.text}</button>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Agregar a contenedor de notificaciones
    let container = document.getElementById('notifications-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notifications-container';
      container.className = 'notifications-container';
      document.body.appendChild(container);
    }

    container.appendChild(notification);

    // Auto-eliminar si se especifica duración
    if (duration > 0) {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, duration);
    }

    return notification;
  }

  // Reproducir sonido de notificación
  playNotificationSound() {
    try {
      const audio = new Audio('/sounds/notification.mp3');
      audio.volume = 0.5;
      audio.play().catch(e => console.log('No se pudo reproducir sonido:', e));
    } catch (error) {
      console.log('Sonido de notificación no disponible');
    }
  }

  // Actualizar contador de órdenes pendientes
  updatePendingOrdersCount() {
    const counter = document.getElementById('pending-orders-count');
    if (counter) {
      const currentCount = parseInt(counter.textContent || '0');
      counter.textContent = currentCount + 1;
      counter.style.display = 'block';
    }
  }

  // Actualizar orden en la UI
  updateOrderInUI(data) {
    const orderRow = document.getElementById(`order-${data.ordenId}`);
    if (orderRow) {
      const statusCell = orderRow.querySelector('.order-status');
      if (statusCell) {
        statusCell.textContent = data.nuevoEstado;
        statusCell.className = `order-status status-${data.nuevoEstado}`;
      }
    }

    // Actualizar detalles si estamos en la página de detalle
    const statusDetail = document.getElementById('order-status-detail');
    if (statusDetail) {
      statusDetail.textContent = data.nuevoEstado;
      statusDetail.className = `status-badge status-${data.nuevoEstado}`;
    }
  }

  // Abrir detalle de orden
  openOrderDetail(ordenId) {
    window.location.href = `/admin/ordenes/${ordenId}`;
  }

  // Cerrar notificación activa
  closeNotification() {
    const notifications = document.querySelectorAll('.notification');
    if (notifications.length > 0) {
      notifications[notifications.length - 1].remove();
    }
  }

  // Manejar errores de conexión
  handleConnectionError(error) {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.showConnectionStatus('Error de conexión', 'error');
      this.showNotification({
        title: 'Error de Conexión',
        message: 'No se pudo conectar al servidor. Las notificaciones en tiempo real no están disponibles.',
        type: 'error',
        duration: 10000
      });
    }
  }

  // Obtener estado de conexión
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      socketId: this.socket?.id,
      tiendaId: this.tiendaId,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // Destruir conexión
  disconnect() {
    this.stopPing();
    
    if (this.tiendaId) {
      this.leaveTienda();
    }
    
    if (this.socket) {
      this.socket.disconnect();
    }
    
    this.callbacks.clear();
    console.log('Socket desconectado y limpiado');
  }
}

// Instancia global del socket manager
let socketManager = null;

// Función para inicializar el socket
function initSocket() {
  if (!socketManager) {
    socketManager = new SocketManager();
  }
  return socketManager;
}

// Función para obtener la instancia del socket
function getSocket() {
  return socketManager;
}

// Auto-inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Solo inicializar en páginas que lo necesiten
  const needsSocket = document.body.classList.contains('needs-socket') || 
                     window.location.pathname.includes('/admin') ||
                     window.location.pathname.includes('/dashboard') ||
                     window.location.pathname.includes('/tienda/');
  
  if (needsSocket) {
    initSocket();
    console.log('Socket.IO cliente inicializado automáticamente');
  }
});

// Exportar para uso global
window.SocketManager = SocketManager;
window.initSocket = initSocket;
window.getSocket = getSocket;