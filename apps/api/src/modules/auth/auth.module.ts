import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './application/auth.service';
import { UsersService } from './application/users.service';
import { User } from './domain/user.entity';
import { AuthController } from './presentation/auth.controller';
import { UsersController } from './presentation/users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_SECRET debe tener al menos 32 caracteres (generá uno con: openssl rand -base64 48)');
        }
        const hours = Number(config.get('JWT_EXPIRES_HOURS', 8));
        return { secret, signOptions: { algorithm: 'HS256', expiresIn: hours * 3600 } };
      },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService],
  // Los guards globales se registran en AppModule y necesitan estos dos.
  exports: [UsersService, JwtModule],
})
export class AuthModule {}
