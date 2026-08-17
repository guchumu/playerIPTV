// Mostrar modal para añadir usuario
function showAddUserModal() {
    document.getElementById('modalTitle').textContent = 'Añadir Usuario';
    document.getElementById('userForm').reset();
    document.getElementById('user_id').value = '';
    document.getElementById('password').required = true;
    document.getElementById('userModal').style.display = 'block';
}

// Editar usuario existente
function editUser(user) {
    document.getElementById('modalTitle').textContent = 'Editar Usuario';
    document.getElementById('user_id').value = user.id;
    document.getElementById('username').value = user.username;
    document.getElementById('email').value = user.email || '';
    document.getElementById('xtream_username').value = user.xtream_username || '';
    document.getElementById('xtream_password').value = user.xtream_password || '';
    document.getElementById('max_connections').value = user.max_connections;
    document.getElementById('active').checked = user.active == 1;
    
    // Formatear fecha para input datetime-local
    if (user.expiration_date) {
        const date = new Date(user.expiration_date);
        const formattedDate = date.toISOString().slice(0, 16);
        document.getElementById('expiration_date').value = formattedDate;
    }
    
    document.getElementById('password').required = false;
    document.getElementById('userModal').style.display = 'block';
}

// Eliminar usuario
function deleteUser(userId, username) {
    if (confirm(`¿Estás seguro de eliminar al usuario "${username}"?\n\nEsta acción no se puede deshacer.`)) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = 'delete_user.php';
        
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'user_id';
        input.value = userId;
        
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
    }
}

// Cerrar modal
function closeModal() {
    document.getElementById('userModal').style.display = 'none';
}

// Cerrar modal al hacer click fuera
window.onclick = function(event) {
    const modal = document.getElementById('userModal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

// Mostrar mensajes de éxito/error
window.addEventListener('load', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const msg = urlParams.get('msg');
    const error = urlParams.get('error');
    
    if (msg === 'created') {
        showNotification('✅ Usuario creado correctamente', 'success');
    } else if (msg === 'updated') {
        showNotification('✅ Usuario actualizado correctamente', 'success');
    } else if (msg === 'deleted') {
        showNotification('🗑️ Usuario eliminado correctamente', 'success');
    } else if (error) {
        showNotification('❌ Error: ' + decodeURIComponent(error), 'error');
    }
});

// Función para mostrar notificaciones
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Animaciones CSS para notificaciones
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
