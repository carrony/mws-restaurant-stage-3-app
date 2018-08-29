const gulp = require("gulp");
const responsive = require("gulp-responsive-images");
const uglify = require("gulp-uglify");
const sass = require("gulp-sass")
const autoprefixer = require('gulp-autoprefixer');
const sourcemaps = require('gulp-sourcemaps');
const babel = require('gulp-babel');
const concat = require('gulp-concat');
const order = require('gulp-order');
const imagemin = require("imagemin");
const pngquant = require("imagemin-pngquant");

// Initializing browsersync object
const browserSync = require('browser-sync');//.create();
const config = {
    server: './dist',
    domain: "localhost:3000",
    files: [
        './dist/css/*.css',
        './*.html',
        './js/*.js'
    ],
    browser: ['chrome'],//,'Firefox'],
    notify: false
};


// copying html file to dist folder
const copyHTML = () => {
    return gulp.src(['./*.html','./sw.js', 'manifest.json'])
        .pipe(gulp.dest('./dist/'));
};

const copyLogo = () => {
    return gulp.src('./img-src/*.svg')
        .pipe(gulp.dest('./dist/img'));
};

// Copying js files for each page of the app
const copyJS = () =>{
    return gulp.src(['./js/main.js', './js/restaurant_info.js'])
        //.pipe(sourcemaps.init())
        //.pipe(babel())
        /*.pipe(uglify({
            mangle: false,

            compress:false//{"unused": false,'collapse_vars': true,"hoist_vars": false,"hoist_funs":false,"if_return":false,"join_vars":false,"loops":false}
         }).on('error', (error) => console.log(error)))*/
        //.pipe(sourcemaps.write())
        .pipe(gulp.dest('./dist/js'));
}

// Creating responsive images
const responsiveImages = () => {
    return gulp.src('img-src/*.jpg')
    .pipe(responsive({
        '*.jpg': [{
            width: 250,
            suffix: '-small'
          }, {
            width: 460,
            suffix: '-medium'
          }, {
            width: 800,
            suffix: '-large',
            quality: 30
          }]
    }))
    .pipe(gulp.dest('./dist/img'));
};

const pngImages = () => {
    return imagemin(['img-src/*.png'], 'dist/img', {use: [pngquant()]}).then(() => {
        console.log('Images optimized');
    });
}

// Minifiying JS files
const jsMinifyDist = () => {
    return gulp.src(//./js/**/*.js')
    [
        './js/idb.js',
        './js/dbhelper.js',
        './js/sw_register.js'//,
        //'./js/main.js'//,
        //'./js/**/*.js' // we can't add *.js, two functions should be created one with
    ])
        .pipe(order([
            'sw_register.js',
            'idb.js',
            'dbhelper.js'//,
            //'main.js'//,
            //'*.js'
        ]))
        .pipe(sourcemaps.init())
        .pipe(babel())
        .pipe(concat('all.js'))
        .pipe(uglify().on('error', (error) => console.log(error)))
        .pipe(sourcemaps.write())
        .pipe(gulp.dest('./dist/js'));
};

// Minifiying JS files development
const jsMinify = () => {
    return gulp.src(//./js/**/*.js')
    [
        './js/idb.js',
        './js/dbhelper.js',
        './js/sw_register.js'//,
        //'./js/main.js'//,
        //'./js/**/*.js' // we can't add *.js, two functions should be created one with
    ])
        .pipe(order([
            'sw_register.js',
            'idb.js',
            'dbhelper.js'//,
            //'main.js'//,
            //'*.js'
        ]))
        .pipe(sourcemaps.init())
        .pipe(babel())
        .pipe(concat('all.js'))
        .pipe(sourcemaps.write())
        .pipe(gulp.dest('./dist/js'));
};

//Sass copiling and autoprefixing
const styles = () => {
    return gulp.src('./sass/**/*.scss')
        .pipe(sourcemaps.init())
        .pipe(sass({
            outputStyle: 'compressed'
        }).on('error', sass.logError))
        .pipe(autoprefixer({
            browsers: ['last 2 versions']
        })
        .pipe(sourcemaps.write())
        .pipe(gulp.dest('./dist/css'))
    );
};

const watchSass = () => {gulp.watch('./sass/**/*.scss', styles);};
const watchScripts = () => {gulp.watch('./js/**/*.js', jsMinify);};
const watchHTML = () => {gulp.watch(['./*.html','manifest.json','sw.js'], copyHTML);};
const watchDist = () => {
    gulp.watch(['./dist/*.html','./dist/css/*.css','./dist/js/*.js']);
};

gulp.task('watch', gulp.parallel(watchSass,watchScripts,watchHTML, watchDist));

gulp.task('browserSync', () => {
    browserSync.init(config);
})

// For procesing images and HTML
const copyAssets = gulp.parallel(copyHTML, copyJS, responsiveImages, pngImages,copyLogo);

// Processing JS and styles
const buildAllDev = gulp.series(copyAssets, styles, jsMinify);
const buildAllDist = gulp.series(copyAssets, styles, jsMinifyDist);

gulp.task('default', gulp.series(buildAllDev, gulp.parallel('watch','browserSync')));

gulp.task('dist', gulp.series(buildAllDist, gulp.parallel('watch','browserSync')));
