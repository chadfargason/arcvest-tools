# ArcVest Website

Modern Next.js website featuring portfolio calculator and investment chatbot integration.

## 🚀 Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## 🛠️ Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Tech Stack

- **Next.js 15** - React framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

## 📁 Structure

```
fargason-capital-site/
├── app/
│   ├── calculator/          # Portfolio calculator page
│   ├── chat/               # Investment chatbot page
│   ├── globals.css         # Global styles
│   ├── layout.tsx          # Root layout
│   └── page.tsx           # Home page
├── lib/
│   └── utils.ts           # Utility functions
├── public/
│   └── calculator.html    # Portfolio calculator
└── package.json
```

## 🎨 Features

- ✅ Modern gradient design
- ✅ Responsive layout
- ✅ Dark mode support
- ✅ Professional UI components
- ✅ Portfolio calculator integration
- ✅ Investment chatbot access

## 🔧 Configuration

No environment variables required for basic setup.

## 🚀 Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Set build command: `npm run build`
3. Set output directory: `.next`
4. Deploy

### Other Platforms

The website can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- Heroku
- AWS Amplify

## 📱 Pages

### Home Page (`/`)
- Landing page with navigation to tools
- Feature highlights
- Professional design

### Calculator Page (`/calculator`)
- Embedded portfolio calculator
- Navigation header
- Responsive iframe

### Chat Page (`/chat`)
- Embedded investment chatbot
- Navigation header
- External chatbot integration

## 🎨 Styling

The website uses Tailwind CSS with custom CSS variables for theming:

- **Colors**: Defined in `globals.css`
- **Components**: Utility classes with custom animations
- **Responsive**: Mobile-first design approach
- **Dark Mode**: Automatic dark mode support

## 🔄 Updates

### Recent Updates (v2.0.0)

- ✅ Updated to Next.js 15 and React 19
- ✅ Added Tailwind CSS integration
- ✅ Modern UI components with Lucide icons
- ✅ Enhanced responsive design
- ✅ Improved navigation and headers
- ✅ Professional gradient backgrounds

## 🐛 Troubleshooting

### Common Issues

1. **Build Errors**
   - Run `npm run type-check` to identify TypeScript issues
   - Check for missing dependencies with `npm install`

2. **Styling Issues**
   - Ensure Tailwind CSS is properly configured
   - Check `globals.css` for custom styles

3. **Iframe Issues**
   - Verify calculator.html exists in public folder
   - Check chatbot URL is accessible

## 📄 License

MIT License - see main project README for details.