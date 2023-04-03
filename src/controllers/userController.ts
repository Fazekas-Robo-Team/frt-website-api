import { Request, Response } from 'express';
import session from 'express-session';
import User from '../models/user';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import dotenv from 'dotenv';
import fs from 'fs';
import { logger } from '../app';
dotenv.config();

const { Storage } = require("@google-cloud/storage");

// get credentials from env GOOGLE_STORAGE_CREDENTIALS
const GOOGLE_STORAGE_CREDENTIALS = process.env.GOOGLE_STORAGE_CREDENTIALS;

const storage = new Storage({
    projectId: "frt-website-382316",
    credentials: JSON.parse(GOOGLE_STORAGE_CREDENTIALS!),
});
const bucket = storage.bucket("frt-blog-images");

class UserController {
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const user = await User.findByPk(req.params.id);
            res.json({ success: true, data: user });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get user :(" });
        }
    }

    public async update(req: Request, res: Response): Promise<void> {
        try {
            const user = await User.findByPk(req.userId);
            if (user) {
                const { username, email, password, description, fullname } = req.body;

                if (username) user.username = username;
                if (email) user.email = email;
                if (password) user.password = await bcrypt.hash(password, 10);
                if (description) user.description = description;
                if (fullname) user.fullname = fullname;

                await user.save();

                res.json({ success: true, data: user });
            }
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to update user :(" });
        }
    }

    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const user = await User.findByPk(req.params.id);
            if (user) {
                await user.destroy();
                res.json({ success: true, data: user });
            }
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to delete user :(" });
        }
    }

    public async getSelfData(req: Request, res: Response): Promise<void> {
        try {
            const user = await User.findByPk(req.userId);
            res.json({ success: true, data: user });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get user :(" });
        }
    }

    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            // get only name, roles and description of the user
            const users = await User.findAll({ attributes: ['id', 'username', 'fullname', 'description', 'roles', 'pfpVersion'] });

            // sort them with this order: Coach, Senior Műhelytag, Műhelytag, Junior Műhelytag, Alumni
            users.sort((a, b) => {
                if (a.roles.includes('Coach')) return -1;
                if (b.roles.includes('Coach')) return 1;
                if (a.roles.includes('Senior Műhelytag')) return -1;
                if (b.roles.includes('Senior Műhelytag')) return 1;
                if (a.roles.includes('Műhelytag')) return -1;
                if (b.roles.includes('Műhelytag')) return 1;
                if (a.roles.includes('Junior Műhelytag')) return -1;
                if (b.roles.includes('Junior Műhelytag')) return 1;
                if (a.roles.includes('Alumni')) return -1;
                if (b.roles.includes('Alumni')) return 1;
                return 0;
            });
            
            res.json({ success: true, data: users });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get users :(" });
        }
    }
 
    public async updatePfp(req: Request, res: Response): Promise<void> {
        try {
            const id = req.userId;

            // @ts-ignore
            const { buffer } = req.file;

            // get the name of the current pfp from database
            const user = await User.findByPk(id);
            const currentVersion = user!.pfpVersion;

            const webpPath = `users/${id}/pfp_?v${currentVersion+1}.webp`;
            const oldWebpPath = `users/${id}/pfp_?v${currentVersion}.webp`;

            // save the image as webp in resolution 512x512
            const webpImageBuffer = await sharp(buffer).resize(512, 512).webp().toBuffer();

            const webpWriteStream = bucket.file(webpPath).createWriteStream({
                metadata: {
                    contentType: 'image/webp',
                    cacheControl: 'public, max-age=31536000',
                },
            });

            // delete the old pfp
            const oldPfp = await bucket.file(oldWebpPath);

            try {
                await oldPfp.delete();
            } catch (error) {}
            
            webpWriteStream.end(webpImageBuffer);       
            
            user!.pfpVersion++;
            await user?.save();

            res.json({ success: true });
        } catch (error) {
            console.log(error);
            res.status(500).json({ success: false, message: "Failed to update pfp :(" });
        }

    }
}

export default new UserController();