import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		port: 10001, // Personaliza el puerto aquí
		open: '/app.html',
	},
	build: {
		outDir: 'dist', // Personaliza la carpeta de salida del build aquí
		rolldownOptions: {
			// Multi-page app: escena principal y visor de piezas
			input: {
				app: resolve(import.meta.dirname, 'app.html'),
				piezas: resolve(import.meta.dirname, 'piezas.html'),
			},
		},
	},
	base: './', // Personaliza el directorio base de los links del HTML aquí
});
