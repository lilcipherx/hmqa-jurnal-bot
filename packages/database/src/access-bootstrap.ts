import { permissions, permissionsFor, roles } from '@hmqa/domain';
import type { DatabaseClient } from './client.js';

export async function seedSystemAccess(database: DatabaseClient): Promise<void> {
  for (const code of permissions) {
    await database.permission.upsert({
      where: { code },
      update: { description: code },
      create: { code, description: code },
    });
  }
  for (const code of roles) {
    const role = await database.role.upsert({
      where: { code },
      update: { description: code, system: true },
      create: { code, description: code, system: true },
    });
    for (const permissionCode of permissionsFor(code)) {
      const permission = await database.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });
      await database.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}
