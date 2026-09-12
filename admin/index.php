<?php
session_start();
require_once '../api/db.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

// Obtener todos los usuarios
$stmt = $pdo->query("SELECT * FROM users ORDER BY created_at DESC");
$users = $stmt->fetchAll();

// Calcular estadísticas
$total_users = count($users);
$active_users = 0;
$expired_users = 0;
$now = new DateTime();

foreach ($users as $user) {
    if ($user['active']) {
        if ($user['expiration_date'] && strtotime($user['expiration_date']) > time()) {
            $active_users++;
        } else {
            $expired_users++;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel Admin - StreamBox IPTV</title>
    <link rel="stylesheet" href="admin_style.css">
</head>
<body>
    <header>
        <div class="header-left">
            <h1>🎛️ Panel de Administración</h1>
            <span class="admin-user">👤 <?php echo $_SESSION['admin_username']; ?></span>
        </div>
        <a href="logout.php" class="btn btn-danger">🚪 Cerrar sesión</a>
    </header>

    <div class="container">
        <!-- Estadísticas -->
        <div class="stats">
            <div class="stat-card">
                <h3>Total Usuarios</h3>
                <p class="stat-number"><?php echo $total_users; ?></p>
            </div>
            <div class="stat-card active">
                <h3>Activos</h3>
                <p class="stat-number"><?php echo $active_users; ?></p>
            </div>
            <div class="stat-card expired">
                <h3>Expirados</h3>
                <p class="stat-number"><?php echo $expired_users; ?></p>
            </div>
        </div>

        <!-- Acciones -->
        <div class="actions">
            <button onclick="showAddUserModal()" class="btn btn-primary">➕ Añadir Usuario</button>
            <a href="../admin_monitor.html" class="btn btn-secondary">📺 Monitor en vivo</a>
            <a href="../ads_upload.php" class="btn btn-secondary">🖼️ Banners</a>
            <button onclick="location.reload()" class="btn btn-secondary">🔄 Actualizar</button>
        </div>

        <!-- Tabla de usuarios -->
        <table class="users-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Usuario</th>
                    <th>Email</th>
                    <th>Xtream User</th>
                    <th>Caducidad</th>
                    <th>Max Con.</th>
                    <th>Estado</th>
                    <th>Último Login</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($users as $user): ?>
                    <?php
                        $expiry = $user['expiration_date'] ? new DateTime($user['expiration_date']) : null;
                        $isExpired = $expiry && $now > $expiry;
                        $statusClass = $isExpired ? 'expired' : ($user['active'] ? 'active' : 'inactive');
                    ?>
                    <tr class="<?php echo $statusClass; ?>">
                        <td><?php echo $user['id']; ?></td>
                        <td><strong><?php echo htmlspecialchars($user['username']); ?></strong></td>
                        <td><?php echo htmlspecialchars($user['email'] ?? '-'); ?></td>
                        <td><?php echo htmlspecialchars($user['xtream_username'] ?? '-'); ?></td>
                        <td>
                            <?php 
                            if ($isExpired) {
                                echo '❌ Expirado';
                            } elseif ($expiry) {
                                $diff = $now->diff($expiry);
                                echo $expiry->format('d/m/Y');
                                echo '<br><small>(' . $diff->days . ' días)</small>';
                            } else {
                                echo '-';
                            }
                            ?>
                        </td>
                        <td><?php echo $user['max_connections']; ?></td>
                        <td>
                            <span class="badge <?php echo $user['active'] ? 'badge-success' : 'badge-danger'; ?>">
                                <?php echo $user['active'] ? '✅ Activo' : '⛔ Inactivo'; ?>
                            </span>
                        </td>
                        <td><?php echo $user['last_login'] ? date('d/m/Y H:i', strtotime($user['last_login'])) : 'Nunca'; ?></td>
                        <td class="actions-cell">
                            <button onclick="editUser(<?php echo htmlspecialchars(json_encode($user)); ?>)" 
                                    class="btn-small btn-warning">✏️</button>
                            <button onclick="deleteUser(<?php echo $user['id']; ?>, '<?php echo htmlspecialchars($user['username']); ?>')" 
                                    class="btn-small btn-danger">🗑️</button>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <!-- Modal para añadir/editar usuario -->
    <div id="userModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h2 id="modalTitle">Añadir Usuario</h2>
            <form id="userForm" method="POST" action="save_user.php">
                <input type="hidden" name="user_id" id="user_id">
                
                <div class="form-group">
                    <label>Usuario Panel: *</label>
                    <input type="text" name="username" id="username" required>
                </div>
                
                <div class="form-group">
                    <label>Contraseña Panel: *</label>
                    <input type="password" name="password" id="password">
                    <small>Dejar en blanco para no cambiar (al editar)</small>
                </div>
                
                <div class="form-group">
                    <label>Email:</label>
                    <input type="email" name="email" id="email">
                </div>
                
                <div class="form-group">
                    <label>Usuario Xtream: *</label>
                    <input type="text" name="xtream_username" id="xtream_username" required>
                </div>
                
                <div class="form-group">
                    <label>Contraseña Xtream: *</label>
                    <input type="text" name="xtream_password" id="xtream_password" required>
                </div>
                
                <div class="form-group">
                    <label>Fecha de Caducidad: *</label>
                    <input type="datetime-local" name="expiration_date" id="expiration_date" required>
                </div>
                
                <div class="form-group">
                    <label>Máximo de Conexiones: *</label>
                    <input type="number" name="max_connections" id="max_connections" value="1" min="1" max="10">
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" name="active" id="active" checked>
                        Usuario Activo
                    </label>
                </div>
                
                <button type="submit" class="btn btn-success">💾 Guardar</button>
            </form>
        </div>
    </div>

    <script src="admin_script.js"></script>
</body>
</html>

