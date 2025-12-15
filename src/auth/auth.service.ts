import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { 
      userId: user.id, 
      email: user.email,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      provider: user.provider || 'email'
    };
    
    return {
      access_token: this.jwtService.sign(payload),
      user: user,
    };
  }

  async register(registrationData: any) {
    const existingUser = await this.usersService.findByEmail(registrationData.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(registrationData.password, 10);
    
    const newUser = await this.usersService.create({
      ...registrationData,
      password: hashedPassword,
    });

    const { password, ...result } = newUser;
    return result;
  }

  async findOrCreateGoogleUser(googleUserData: {
    email: string;
    firstName?: string;
    lastName?: string;
  }) {
    let user = await this.usersService.findByEmail(googleUserData.email);
    
    if (!user) {
      // Create trial user for new Google signups
      user = await this.usersService.createTrial({
        email: googleUserData.email,
        firstName: googleUserData.firstName || '',
        lastName: googleUserData.lastName || '',
        password: undefined, // No password for OAuth users
      });
    }
    
    const result = { ...user, provider: 'google' };
    return result;
  }
}

