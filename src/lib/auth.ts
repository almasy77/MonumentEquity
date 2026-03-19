import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getEntity } from "./db";
import type { User } from "./validations";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: "admin" | "va" | "viewer";
    };
  }
  interface User {
    role: "admin" | "va" | "viewer";
  }
}

declare module "next-auth" {
  interface JWT {
    id: string;
    role: "admin" | "va" | "viewer";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Look up user by email index
        const { getRedis } = await import("./db");
        const userId = await getRedis().get<string>(`user:email:${email}`);
        if (!userId) return null;

        const user = await getEntity<User>(`user:${userId}`);
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "admin" | "va" | "viewer";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
