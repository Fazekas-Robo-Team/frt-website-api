import { Request, Response } from "express";
import Post from "../models/blog";
import fs from "fs";
import dotenv from "dotenv";
import User from "../models/user";
import { buildFrontend } from "../app";
import { logger } from "../app";
import path from "path";
import sharp from "sharp";
const { Storage } = require("@google-cloud/storage");

// get credentials from env GOOGLE_STORAGE_CREDENTIALS
const GOOGLE_STORAGE_CREDENTIALS = process.env.GOOGLE_STORAGE_CREDENTIALS;

const storage = new Storage({
    projectId: "frt-website-382316",
    credentials: JSON.parse(GOOGLE_STORAGE_CREDENTIALS!),
});
const bucket = storage.bucket("frt-blog-images");

dotenv.config();

class BlogController {
    constructor() {
        this.getPosts = this.getPosts.bind(this);
        this.getPost = this.getPost.bind(this);
        this.createPost = this.createPost.bind(this);
        this.publishPost = this.publishPost.bind(this);
        this.deactivePost = this.deactivePost.bind(this);
        this.deletePost = this.deletePost.bind(this);
    }
    public async getPosts(req: Request, res: Response): Promise<void> {
        try {
            const posts = await Post.findAll();

            // send title, user fullname, date, id and state, then sort by date
            const postsData = await Promise.all(
                posts.map(async (post) => {
                    // get the user fullname
                    const user = await User.findOne({ where: { id: post.userId } });

                    // format the date in yyyy-mm-dd format
                    const date = new Date(post.createdAt).toISOString().slice(0, 10);

                    // state: published or draft, if published and index is true, then it's a featured post
                    let state = "draft";
                    if (post.published) {
                        state = "published";
                        if (post.featured) {
                            state = "published (featured)";
                        }
                    }

                    return {
                        title: post.title,
                        author: user?.fullname,
                        date: date,
                        id: post.id,
                        state: state,
                    };
                })
            );

            // sort by id reversed
            postsData.sort((a: any, b: any) => a.id - b.id);

            res.json({ success: true, data: postsData });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get posts :(" });
        }
    }

    public async getPublicPosts(req: Request, res: Response): Promise<void> {
        try {
            const posts = await Post.findAll({ where: { published: true } });

            // send title, user fullname, date and id
            const postsData = await Promise.all(
                posts.map(async (post) => {
                    // get the user fullname
                    const user = await User.findOne({ where: { id: post.userId } });

                    // format the date in yyyy-mm-dd format
                    const date = new Date(post.createdAt).toISOString().slice(0, 10);

                    return {
                        id: post.id,
                        title: post.title,
                        description: post.description,
                        content: post.content,
                        author: user?.fullname,
                        date: date,
                        slug: post.slug,
                        featured: post.featured,
                    };
                })
            );

            res.json({ success: true, data: postsData });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get posts :(" });
        }
    }

    public async getPost(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            
            const post = await Post.findOne({ where: { id } });
            res.json({ success: true, data: post });
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to get post :(" });
        }
    }

    public async createPost(req: Request, res: Response): Promise<void> {
        try {
            const { title, description, content, category } = req.body;

            // modify the title to be slug friendly
            const slugTitle = title
                .toLowerCase()
                .replace(/ /g, "-")
                .replace(/[^\w-]+/g, "");

            // generate slug with category/title/date combo
            let date = new Date().toISOString().slice(0, 10);

            // replace the dashes with underscores
            date = date.replace(/-/g, "_");

            const slug = `${date}/${category}/${slugTitle}`;

            const post = await Post.create({
                title: title,
                description: description,
                content: content,
                slug: slug,
                category: category,
                userId: req.userId,
            });

            // get buffer from req files with the name index
            // @ts-ignore
            const index = req.files?.index[0].buffer;

            const webpImageBuffer = await sharp(index).resize({width: 800, fit: "contain"}).webp().toBuffer();

            const webpFilePath = `${post.id}/index.webp`;

            const webpWriteStream = bucket.file(webpFilePath).createWriteStream({
                metadata: {
                    contentType: "image/webp",
                    cacheControl: "public, max-age=31536000",
                },
            });

            webpWriteStream.end(webpImageBuffer);

            // get buffer from req files with the name images[]
            // @ts-ignore
            const images = req.files["images[]"];

            if (images) {
                // loop through the images and save them
                for (let i = 0; i < images.length; i++) {
                    const image_name = images[i].originalname;

                    // get the name without the extension
                    const name = image_name.split(".")[0];

                    const image = images[i].buffer;
                    const imgBuffer = await sharp(image).resize({width: 800, fit: "contain"}).webp().toBuffer();

                    const imgFilePath = `${post.id}/${name}.webp`;

                    const imgFileStream = bucket.file(imgFilePath).createWriteStream({
                        metadata: {
                            contentType: "image/webp",
                            cacheControl: "public, max-age=31536000",
                        },
                    });

                    imgFileStream.end(imgBuffer);
                }
            }
            
            res.json({ success: true, data: post });
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to create post :(" });
        }
    }

    public async publishPost(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const post = await Post.findOne({ where: { id } });

            if (post) {
                const { title } = post;

                const user = await User.findOne({ where: { id: req.userId } });

                post.published = true;
                await post.save();

                logger.info(`${user?.fullname} published post ${title}!`);
                res.status(200).json({ success: true });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to publish post :(" });
        }
    }

    public async deactivePost(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const post = await Post.findOne({ where: { id } });

            if (post) {
                const { title } = post;

                const user = await User.findOne({ where: { id: req.userId } });

                post.published = false;
                await post.save();

                logger.info(`${user?.fullname} deactived post ${title}!`);

                res.status(200).json({ success: true });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            res.status(500).json({ success: false, message: "Failed to deactive post :(" });
        }
    }

    public async editPost(req: Request, res: Response): Promise<void> {
        try {
            const { title, description, content, category } = req.body;

            const { id } = req.params;

            const post = await Post.findOne({ where: { id } });

            const user = await User.findOne({ where: { id: req.userId } });

            if (post) {
                post.description = description;

                post.content = content;
                
                // if the user uploaded a new image, save it
                // get buffer from req files with the name images[]
                // @ts-ignore
                const images = req.files["images[]"];

                if (images) {
                    // loop through the images and save them
                    for (let i = 0; i < images.length; i++) {
                        const image_name = images[i].originalname;

                        // get the name without the extension
                        const name = image_name.split(".")[0];

                        const image = images[i].buffer;
                        const imgBuffer = await sharp(image).resize({width: 800, fit: "contain"}).webp().toBuffer();

                        const imgFilePath = `${post.id}/${name}.webp`;

                        const imgFileStream = bucket.file(imgFilePath).createWriteStream({
                            metadata: {
                                contentType: "image/webp",
                                cacheControl: "public, max-age=31536000",
                            },
                        });

                        imgFileStream.end(imgBuffer);
                    }
                }

                post.save();

                logger.info(`${user?.username} edited post ${title}!`);

                res.status(200).json({ success: true });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to edit post :(" });
        }
    }

    public async deletePost(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const post = await Post.findOne({ where: { id } });

            if (post) {
                // delete the post from the database
                await post.destroy();

                res.status(200).json({ success: true });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to delete post :(" });
        }
    }

    public async makeFeatured(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const post = await Post.findOne({ where: { id } });

            if (post) {
                // if the post is already featured, return
                if (post.featured) {
                    res.status(200).json({ success: true });
                    return;
                }

                // make all other posts not featured
                await Post.update({ featured: false }, { where: { featured: true } });

                post.featured = true;
                await post.save();

                res.status(200).json({ success: true });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to make post featured :(" });
        }
    }

    public async uploadImage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const post = await Post.findOne({ where: { id } });
        
            if (post) {
                // @ts-ignore
                const image = req.file?.buffer;

                const webpImageBuffer = await sharp(image).resize({width: 800, fit: "contain"}).webp().toBuffer();

                // get filename without extension
                // @ts-ignore
                const name = req.file?.originalname.split(".")[0];

                const webpFilePath = `${post.id}/${name}.webp`;

                const webpWriteStream = bucket.file(webpFilePath).createWriteStream({
                    metadata: {
                        contentType: "image/webp",
                    },
                });

                webpWriteStream.end(webpImageBuffer);

                res.status(200).json({ success: true, filename: webpFilePath });
            } else {
                res.status(404).json({ success: false, message: "Post not found :(" });
            }
        } catch (error) {
            logger.error(error);
            res.status(500).json({ success: false, message: "Failed to upload image :(" });
        }
    }
}

export default new BlogController();
